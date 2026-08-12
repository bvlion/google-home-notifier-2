const googlehome = require('./google-home-notifier-2')
const { loadConfig } = require('./config')
const ngrok = require("@ngrok/ngrok")
const bodyParser = require('body-parser')
const fs = require('fs')
const express = require('express')
const app = express()

const urlencodedParser = bodyParser.urlencoded({ extended: false })

const {
  serverPort,
  language,
  voice,
  mp3Url,
  notifyUrl,
  mp3OutputPath,
  googleHomeIp,
  ngrokAuthtoken
} = loadConfig(process.env)

app.get(mp3Url, (_, res) =>
  fs.readFile(mp3OutputPath, (_, data) =>
    res.status(200).send(new Buffer.from(data, 'binary'))
  )
)

app.post(notifyUrl, urlencodedParser, (req, res) => {

  if (!req.body) {
      return res.sendStatus(400)
  }

  const text = req.body.text
  if (text) {
    googlehome.setUp(language, voice, mp3OutputPath)
    // GOOGLE_HOME_IP は固定の1台のみへ通知するこのサンプルrunner向けの任意設定。
    // リクエストごとに通知先を切り替えたい場合は、script/ 以下のカスタムrunnerで
    // リクエスト内容に応じて googlehome.ip(ip) を呼び出す実装にすること。
    if (googleHomeIp) {
      googlehome.ip(googleHomeIp)
    }

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

app.listen(serverPort, () => {
  (async () => {
    const listener = await ngrok.forward({ addr: serverPort, authtoken: ngrokAuthtoken })
    const url = listener.url()
    console.log('ngrok Endpoints:' + url)
    console.log('POST example:')
    console.log('curl -X POST -d "text=こんにちは" http://localhost:' + serverPort + notifyUrl)
    googlehome.ngrokUrl(url + mp3Url)
  })()
})
