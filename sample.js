const express = require('express')
const googlehome = require(__dirname + '/google-home-notifier-2')
const ngrok = require('ngrok')
const bodyParser = require('body-parser')
const fs = require('fs')
const app = express()

const urlencodedParser = bodyParser.urlencoded({ extended: false })

const serverPort = 8091
const language = 'ja-JP'
const voice = 'ja-JP-Standard-A'
const mp3Url = '/text-mp3'
const notifyUrl = '/google-home-notifier'
const mp3OutputPath = 'sample.mp3'
const ip = '192.168.11.100'

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
    googlehome.ip(ip)

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
    const url = await ngrok.connect({addr: serverPort})
    console.log('ngrok Endpoints:' + url)
    console.log('POST example:')
    console.log('curl -X POST -d "text=こんにちは" http://localhost:' + serverPort + notifyUrl)
    googlehome.ngrokUrl(url + mp3Url)
  })()
})
