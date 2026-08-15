// Based on: https://github.com/noelportugal/google-home-notifier
// Original work Copyright (c) 2017 noelportugal
// Modified by bvlion
// Released under the MIT License

const Client = require('castv2-client').Client
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver
const { createGoogleCastBrowser } = require('./mdns-browser')
const fs = require('fs')
const textToSpeech = require('@google-cloud/text-to-speech')
const { generateRequestId, resolveRequestMp3Path, appendRequestId, registerForCleanup } = require('./request-mp3')
// Application Default Credentialsで認証する。サービスアカウントJSONを使う場合は
// 環境変数 GOOGLE_APPLICATION_CREDENTIALS にそのパスを設定する。
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

// IP未指定時のmDNSディスカバリで、発見したデバイス名がここで設定した名前を
// 含むかどうかの絞り込みに使う(前方一致・完全一致ではなく部分一致)。
var device = (name) => deviceName = name

var volume = (newVolume) => {
  if (0.0 <= newVolume && newVolume <= 1.0) {
    volumeLevel = newVolume
  }
}

var ngrokUrl = (url) => ttsAudioUrl = url

const notify = (message, callback) => start(message, callback, getSpeechUrl)

const play = (mp3_url, callback) => start(mp3_url, callback, getPlayUrl)

// 呼び出し時点の設定値をここでsnapshotする。後続処理は非同期(mDNS探索やTTS/Cast通信待ち)
// なので、module共有状態を後で読み直すと、その間の別リクエストのsetUp()等で値が変わりうる。
const start = (target, callback, func) => {
  const settings = {
    vol: volumeLevel,
    lang: language,
    voice: voiceName,
    outputPath: audioFilePath,
    playbackUrl: ttsAudioUrl
  }

  if (!deviceAddress) {
    // onUpが同期的に発火してもcurrentBrowser未代入で参照されないよう、宣言と代入を分けている。
    let currentBrowser
    currentBrowser = createGoogleCastBrowser((service) => {
      console.log('Device "%s" at %s:%d', service.name, service.addresses[0], service.port)
      if (service.name.includes(deviceName.replace(' ', '-'))) {
        deviceAddress = service.addresses[0]
        if (currentBrowser) {
          currentBrowser.stop()
        }
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

// idなし互換用にmp3OutputPath自体も更新する。fs.rename()はatomicなので、読んでいる側が
// 書きかけの内容を読むことはない。失敗してもログ出力のみでdone()は呼び、後続処理へ進める
// (doneは「進んでよいタイミング」を伝えるだけで、成否はnotify()のcallbackに影響させない)。
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

    const requestId = generateRequestId()
    const requestOutputPath = resolveRequestMp3Path(outputPath, requestId)
    const requestPlaybackUrl = appendRequestId(playbackUrl, requestId)

    fs.writeFile(requestOutputPath, response.audioContent, 'binary', err => {
      if (err) {
        console.error('ERROR:', err)
        callback('error')
        return
      }
      // Castが実際にGETしなかった場合の最後の砦。実GET契機のcleanupはmarkServed()(request-mp3.js)が担う。
      registerForCleanup(requestOutputPath)
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
  // 'error'イベントとlaunch/loadのコールバックエラーが重複して発火してもcallbackを二重に呼ばない。
  let settled = false
  const finish = (res) => {
    if (settled) return
    settled = true
    client.close()
    callback(res)
  }

  // client.connect()より先に登録する('error'イベントの購読漏れを防ぐ)。
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
