// Copyright（c）2017 noelportugal
// Released under the MIT licens
// https://github.com/noelportugal/google-home-notifier/blob/master/LICENSE

const Client = require('castv2-client').Client
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver
const mdns = require('mdns')
const browser = mdns.createBrowser(mdns.tcp('googlecast'))
const fs = require('fs') 
const textToSpeech = require('@google-cloud/text-to-speech') 
const client = new textToSpeech.TextToSpeechClient() 

var audioFilePath
var deviceAddress
var language
var voiceName
var volume
var ngrokUrl

var setUp = (lang, voice, path) => {
  language = lang
  voiceName = voice
  audioFilePath = path
}

var ip = (ip) => deviceAddress = ip

var volume = (newVolume) => {
  if (0.0 <= newVolume && newVolume <= 1.0) {
    volume = newVolume
  }
}

var ngrokUrl = (url) => ngrokUrl = url

const notify = (message, callback) => start(message, callback, getSpeechUrl)

const play = (mp3_url, callback) => start(mp3_url, callback, getPlayUrl)

const start = (target, callback, func) => {
  if (!deviceAddress) {
    browser.start()
    browser.on('serviceUp', (service) => {
      console.log('Device "%s" at %s:%d', service.name, service.addresses[0], service.port)
      if (service.name.includes(device.replace(' ', '-'))) {
        deviceAddress = service.addresses[0]
        func(target, deviceAddress, (res) => {
          callback(res)
        })
      }
      browser.stop()
    })
  } else {
    func(target, deviceAddress, (res) => {
      callback(res)
    })
  }
}

const getSpeechUrl = (text, host, callback) => {
  const request = {
    input: {text: text},
    voice: {
      languageCode: language,
      name: voiceName
    },
    audioConfig: {audioEncoding: 'MP3'}
  }
   
  client.synthesizeSpeech(request, (err, response) => {
    if (err) {
      console.error('ERROR:', err)
      return
    }
   
    fs.writeFile(audioFilePath, response.audioContent, 'binary', err => {
      if (err) {
        console.error('ERROR:', err)
        return
      } 
      onDeviceUp(host, ngrokUrl, (res) => {
        callback(res)
      })
   })
  })
}

const getPlayUrl = (url, host, callback) => 
  onDeviceUp(host, url, (res) => {
    callback(res)
  })


const onDeviceUp = (host, url, callback) => {
  const client = new Client()
  client.connect(host, () => {
    if (volume) {
      client.getVolume((_, v) =>
        client.setVolume({level: volume}, (_, v) => {})
      )
    }
    client.launch(DefaultMediaReceiver, (_, player) => {

      const media = {
        contentId: url,
        contentType: 'audio/mp3',
        streamType: 'BUFFERED' // or LIVE
      }
      player.load(media, { autoplay: true }, (_, status) => {
        client.close()
        callback('Device notified')
      })
    })
  })

  client.on('error', (err) => {
    console.log('Error: %s', err.message)
    client.close()
    callback('error')
  })
}

exports.ip = ip
exports.volume = volume
exports.ngrokUrl = ngrokUrl
exports.setUp = setUp
exports.notify = notify
exports.play = play