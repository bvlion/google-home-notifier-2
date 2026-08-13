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

    fs.writeFile(outputPath, response.audioContent, 'binary', err => {
      if (err) {
        console.error('ERROR:', err)
        callback('error')
        return
      }
      onDeviceUp(host, playbackUrl, vol, (res) => {
        callback(res)
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
