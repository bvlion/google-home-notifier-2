// Based on: https://github.com/noelportugal/google-home-notifier
// Original work Copyright (c) 2017 noelportugal
// Modified by bvlion
// Released under the MIT License

const Client = require('castv2-client').Client
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver
const mdns = require('mdns')
const browser = mdns.createBrowser(mdns.tcp('googlecast'))
const fs = require('fs')
const textToSpeech = require('@google-cloud/text-to-speech')
const { generateRequestId, resolveRequestMp3Path, appendRequestId, registerForCleanup } = require('./request-mp3')
// Google Cloud クライアントライブラリの標準的な認証(Application Default Credentials)を利用する。
// サービスアカウントJSONを使う場合は環境変数 GOOGLE_APPLICATION_CREDENTIALS にそのパスを設定する。
const client = new textToSpeech.TextToSpeechClient()

var audioFilePath
var deviceAddress
var deviceName
var language
var voiceName
var volumeLevel
var ttsAudioUrl

var setUp = (lang, voice, path) => {
  language = lang
  voiceName = voice
  audioFilePath = path
}

var ip = (ip) => deviceAddress = ip

// 派生元 noelportugal/google-home-notifier にあった `device(name)` 相当。
// IP未指定時のmDNSディスカバリで、発見したデバイス名がここで設定した名前を
// 含むかどうかの絞り込みに使う(deviceName未設定時の挙動は ip() 同様に呼び出し側の責務)。
var device = (name) => deviceName = name

var volume = (newVolume) => {
  if (0.0 <= newVolume && newVolume <= 1.0) {
    volumeLevel = newVolume
  }
}

var ngrokUrl = (url) => ttsAudioUrl = url

const notify = (message, callback) => start(message, callback, getSpeechUrl)

const play = (mp3_url, callback) => start(mp3_url, callback, getPlayUrl)

// volumeLevel/language/voiceName/audioFilePath/ttsAudioUrlは呼び出し時点の値をここで
// まとめて捕捉し、以降の処理へ引き回す。IP未指定時はfunc()の実行(getSpeechUrl/getPlayUrl)が
// serviceUpまで非同期に遅延し、IP指定時もTTS/Cast通信自体が非同期で完了するため、
// module共有状態を後続処理内で再読込すると、その間に別リクエストがsetUp()/volume()/
// ngrokUrl()等を呼び出した場合に値が上書きされうる。
const start = (target, callback, func) => {
  const settings = {
    vol: volumeLevel,
    lang: language,
    voice: voiceName,
    outputPath: audioFilePath,
    playbackUrl: ttsAudioUrl
  }

  if (!deviceAddress) {
    browser.start()
    browser.on('serviceUp', (service) => {
      console.log('Device "%s" at %s:%d', service.name, service.addresses[0], service.port)
      if (service.name.includes(deviceName.replace(' ', '-'))) {
        deviceAddress = service.addresses[0]
        // 対象デバイスが見つかった場合のみ探索を終了する。対象外デバイスのserviceUpでは
        // 探索を継続しないと、対象デバイスが後から見つかるケースを取りこぼす。
        browser.stop()
        func(target, deviceAddress, settings, (res) => {
          callback(res)
        })
      }
    })
  } else {
    func(target, deviceAddress, settings, (res) => {
      callback(res)
    })
  }
}

// idなしでの GET /text-mp3(従来からの利用方法)向けに、request固有MP3の内容を
// mp3OutputPath自体にも反映する。fs.rename()によるディレクトリエントリの置き換えはatomicなため、
// mp3OutputPathを読んでいる側が書きかけの内容(破損・空)を読むことはない。複数のnotify()が
// ほぼ同時に完了した場合、mp3OutputPathの内容がどちらの結果になるかは保証しないが、
// 内容が破損することはなく、#73が問題にしていた「同一ファイルへの競合書き込み」は発生しない。
// 元実装がfs.writeFile()完了後にのみCast処理へ進んでいたのと同じ順序を維持するため、
// copyFile/renameが成功・失敗いずれで終わった場合もdone()を呼んでから後続処理(onDeviceUp)へ
// 進めるようにする。ここでの失敗はログ出力のみ行い、notify()のcallbackには影響させない
// (doneはあくまで「後続処理へ進んでよいタイミング」を伝えるだけで、成否は伝えない)。
const updateLatestMp3 = (requestOutputPath, outputPath, done) => {
  const tmpPath = `${requestOutputPath}.tmp`
  fs.copyFile(requestOutputPath, tmpPath, (err) => {
    if (err) {
      console.error('ERROR:', err)
      done()
      return
    }
    fs.rename(tmpPath, outputPath, (err) => {
      if (err) {
        console.error('ERROR:', err)
        fs.unlink(tmpPath, () => done())
        return
      }
      done()
    })
  })
}

const getSpeechUrl = (text, host, settings, callback) => {
  const { vol, lang, voice, outputPath, playbackUrl } = settings

  const request = {
    input: {text: text},
    voice: {
      languageCode: lang,
      name: voice
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: '0.8'
    }
  }

  client.synthesizeSpeech(request, (err, response) => {
    if (err) {
      console.error('ERROR:', err)
      callback('error')
      return
    }

    // 複数のnotify()が同時に完了しても同一ファイル/同一URLへ書き込み・アクセスが
    // 競合しないよう、TTSごとに一意なファイルパスと配信URLをここで都度生成する。
    const requestId = generateRequestId()
    const requestOutputPath = resolveRequestMp3Path(outputPath, requestId)
    const requestPlaybackUrl = appendRequestId(playbackUrl, requestId)

    fs.writeFile(requestOutputPath, response.audioContent, 'binary', err => {
      if (err) {
        console.error('ERROR:', err)
        callback('error')
        return
      }
      // Castが実際にGETしなかった場合の最後の砦としてのcleanupを予約する。
      // 実際のGETを契機にしたcleanupはMP3配信用server側でmarkServed()により行われる(request-mp3.js)。
      registerForCleanup(requestOutputPath)
      // idなし互換用ファイル(mp3OutputPath)への反映が完了(成功・失敗いずれか)してから
      // Cast処理へ進む。元実装がfs.writeFile()完了後にのみCast処理へ進んでいた順序を維持するため。
      updateLatestMp3(requestOutputPath, outputPath, () => {
        onDeviceUp(host, requestPlaybackUrl, vol, (res) => {
          callback(res)
        })
      })
   })
  })
}

const getPlayUrl = (url, host, settings, callback) =>
  onDeviceUp(host, url, settings.vol, (res) => {
    callback(res)
  })


const onDeviceUp = (host, url, vol, callback) => {
  const client = new Client()
  // 成功/エラーいずれの経路でも callback は最大1回だけ呼び出す(client の 'error' イベントと
  // launch/load のコールバックエラーが重複して発火してもcallbackを二重に呼ばないため)。
  let settled = false
  const finish = (res) => {
    if (settled) return
    settled = true
    client.close()
    callback(res)
  }

  // client.connect()より先に登録する: connect()呼び出し中に同期的にlaunch/load成功まで
  // 進む(テストのmock等)場合でも、'error'イベントの購読漏れが起きないようにするため。
  client.on('error', (err) => {
    console.log('Error: %s', err.message)
    finish('error')
  })

  client.connect(host, () => {
    if (vol) {
      client.getVolume((err) => {
        if (err) {
          console.error('ERROR:', err)
          return
        }
        client.setVolume({level: vol}, (err) => {
          if (err) {
            console.error('ERROR:', err)
          }
        })
      })
    }
    client.launch(DefaultMediaReceiver, (err, player) => {
      if (err) {
        console.error('ERROR:', err)
        finish('error')
        return
      }

      const media = {
        contentId: url,
        contentType: 'audio/mp3',
        streamType: 'BUFFERED' // or LIVE
      }
      player.load(media, { autoplay: true }, (err) => {
        if (err) {
          console.error('ERROR:', err)
          finish('error')
          return
        }
        finish('Device notified')
      })
    })
  })
}

exports.ip = ip
exports.device = device
exports.volume = volume
exports.ngrokUrl = ngrokUrl
exports.setUp = setUp
exports.notify = notify
exports.play = play
