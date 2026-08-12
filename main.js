const googlehome = require('./google-home-notifier-2')
const { loadConfig, requireGoogleHomeIp } = require('./config')
const ngrok = require("@ngrok/ngrok")
const bodyParser = require('body-parser')
const fs = require('fs')
const express = require('express')

const urlencodedParser = bodyParser.urlencoded({ extended: false })

// 通知用app。LAN / localhost等の信頼できるネットワークからの利用を前提とし、ngrokへは公開しない。
const createNotifyApp = ({ notifyUrl, googleHomeIp, language, voice, mp3OutputPath }) => {
  const app = express()

  app.post(notifyUrl, urlencodedParser, (req, res) => {

    if (!req.body) {
        return res.sendStatus(400)
    }

    const text = req.body.text
    if (text) {
      googlehome.setUp(language, voice, mp3OutputPath)
      googlehome.ip(googleHomeIp)

      if (req.body.volume > 0) {
          googlehome.volume(req.body.volume / 100)
      }

      try {
        if (text.slice(0, 4) == 'http') {
          const mp3_url = text
          googlehome.play(mp3_url, (notifyRes) => {
            console.log(notifyRes)
            res.send('「' + mp3_url + '」の音楽を再生しました。\n')
          })
        } else {
          googlehome.notify(text, (notifyRes) => {
            console.log(notifyRes)
            res.send('「' + text + '」と言いました。\n')
          })
        }
      } catch(err) {
        console.log(err)
        res.sendStatus(500)
        res.send(err)
      }
    } else {
      res.send('Please GET "text=こんにちは！"')
    }
  })

  return app
}

// MP3配信用app。Google Home / Castデバイスが生成済みMP3を取得できるよう、このappだけをngrokへ公開する。
const createMp3App = ({ mp3Url, mp3OutputPath }) => {
  const app = express()

  app.get(mp3Url, (_, res) =>
    fs.readFile(mp3OutputPath, (_, data) =>
      res.status(200).send(new Buffer.from(data, 'binary'))
    )
  )

  return app
}

// MP3配信用appをlistenし、ngrokをそのポートだけへforwardする。
// ngrok URLの固定化はせず、起動のたびに取得したURL + mp3Urlをgooglehome.ngrokUrl()へ設定する(既存挙動を維持)。
const startMp3Server = (mp3App, { mp3ServerPort, mp3Url, ngrokAuthtoken }) =>
  new Promise((resolve) => {
    const server = mp3App.listen(mp3ServerPort, () => {
      (async () => {
        const listener = await ngrok.forward({ addr: mp3ServerPort, authtoken: ngrokAuthtoken })
        const url = listener.url()
        console.log('MP3配信用サーバー起動: http://localhost:' + mp3ServerPort + mp3Url)
        console.log('ngrok Endpoints:' + url)
        googlehome.ngrokUrl(url + mp3Url)
        resolve(server)
      })()
    })
  })

const start = () => {
  const config = loadConfig(process.env)
  const {
    serverPort,
    mp3ServerPort,
    language,
    voice,
    mp3Url,
    notifyUrl,
    mp3OutputPath,
    ngrokAuthtoken
  } = config

  // このファイルは固定1台のデバイスにのみ通知するsample runnerのため、
  // GOOGLE_HOME_IP を必須として検証する(ライブラリ/共通設定としては任意のまま)。
  const googleHomeIp = requireGoogleHomeIp(config)

  const notifyApp = createNotifyApp({ notifyUrl, googleHomeIp, language, voice, mp3OutputPath })
  const mp3App = createMp3App({ mp3Url, mp3OutputPath })

  // 通知用serverはLAN / localhost向けで、ngrokへは公開しない。
  notifyApp.listen(serverPort, () => {
    console.log('通知用サーバー起動: http://localhost:' + serverPort + notifyUrl)
    console.log('POST example:')
    console.log('curl -X POST -d "text=こんにちは" http://localhost:' + serverPort + notifyUrl)
  })

  startMp3Server(mp3App, { mp3ServerPort, mp3Url, ngrokAuthtoken })
}

if (require.main === module) {
  start()
}

exports.createNotifyApp = createNotifyApp
exports.createMp3App = createMp3App
exports.startMp3Server = startMp3Server
