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

var device = (name) => deviceName = name

var volume = (newVolume) => {
  if (0.0 <= newVolume && newVolume <= 1.0) {
    volumeLevel = newVolume
  }
}

var ngrokUrl = (url) => ttsAudioUrl = url

const notify = (message, callback) => start(message, callback, getSpeechUrl)

const play = (mp3_url, callback) => start(mp3_url, callback, getPlayUrl)

// 非同期処理待ちの間に別リクエストがmodule共有状態を書き換えても影響を受けないよう、ここでsnapshotする。
const start = (target, callback, func) => {
  const settings = {
    vol: volumeLevel,
    lang: language,
    voice: voiceName,
    outputPath: audioFilePath,
    playbackUrl: ttsAudioUrl
  }

  if (!deviceAddress) {
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

// mp3OutputPathへはcopy+renameでatomicに反映する(読み手が書きかけの内容を読まない)。失敗してもnotify()自体は継続する。
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
  let settled = false
  const finish = (res) => {
    if (settled) return
    settled = true
    client.close()
    callback(res)
  }

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
        streamType: 'BUFFERED'
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
