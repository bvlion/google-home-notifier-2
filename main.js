const googlehome = require('./google-home-notifier-2')
const { loadConfig, requireGoogleHomeIp } = require('./config')
const { isValidRequestId, resolveRequestMp3Path, markServed, cleanupOrphanedRequestFiles } = require('./request-mp3')
const ngrok = require("@ngrok/ngrok")
const bodyParser = require('body-parser')
const fs = require('fs')
const express = require('express')

const urlencodedParser = bodyParser.urlencoded({ extended: false })

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
            if (notifyRes === 'error') {
              res.status(500).send('「' + mp3_url + '」の再生に失敗しました。\n')
            } else {
              res.send('「' + mp3_url + '」の音楽を再生しました。\n')
            }
          })
        } else {
          googlehome.notify(text, (notifyRes) => {
            console.log(notifyRes)
            if (notifyRes === 'error') {
              res.status(500).send('「' + text + '」の通知に失敗しました。\n')
            } else {
              res.send('「' + text + '」と言いました。\n')
            }
          })
        }
      } catch(err) {
        console.log(err)
        res.status(500).send(String(err))
      }
    } else {
      res.send('Please GET "text=こんにちは！"')
    }
  })

  return app
}

const createMp3App = ({ mp3Url, mp3OutputPath }) => {
  const app = express()

  cleanupOrphanedRequestFiles(mp3OutputPath)

  app.get(mp3Url, (req, res) => {
    const id = req.query.id
    let targetPath = mp3OutputPath
    let isRequestSpecific = false

    if (id !== undefined) {
      if (!isValidRequestId(id)) {
        res.sendStatus(400)
        return
      }
      targetPath = resolveRequestMp3Path(mp3OutputPath, id)
      isRequestSpecific = true
    }

    fs.readFile(targetPath, (err, data) => {
      if (err) {
        console.error('ERROR:', err)
        res.sendStatus(err.code === 'ENOENT' ? 404 : 500)
        return
      }
      if (isRequestSpecific) {
        markServed(targetPath)
      }
      res.status(200).send(Buffer.from(data, 'binary'))
    })
  })

  return app
}

const startMp3Server = (mp3App, { mp3ServerPort, mp3Url, ngrokAuthtoken }) =>
  new Promise((resolve, reject) => {
    const server = mp3App.listen(mp3ServerPort)

    server.once('error', reject)

    server.once('listening', () => {
      (async () => {
        try {
          const listener = await ngrok.forward({ addr: mp3ServerPort, authtoken: ngrokAuthtoken })
          const url = listener.url()
          console.log('MP3配信用サーバー起動: http://localhost:' + mp3ServerPort + mp3Url)
          console.log('ngrok Endpoints:' + url)
          googlehome.ngrokUrl(url + mp3Url)
          resolve(server)
        } catch (err) {
          server.close()
          reject(err)
        }
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

  const googleHomeIp = requireGoogleHomeIp(config)

  const notifyApp = createNotifyApp({ notifyUrl, googleHomeIp, language, voice, mp3OutputPath })
  const mp3App = createMp3App({ mp3Url, mp3OutputPath })

  notifyApp.listen(serverPort, () => {
    console.log('通知用サーバー起動: http://localhost:' + serverPort + notifyUrl)
    console.log('POST example:')
    console.log('curl -X POST -d "text=こんにちは" http://localhost:' + serverPort + notifyUrl)
  })

  startMp3Server(mp3App, { mp3ServerPort, mp3Url, ngrokAuthtoken }).catch((err) => {
    console.error('MP3配信用サーバーの起動に失敗しました:', err)
    process.exit(1)
  })
}

if (require.main === module) {
  start()
}

exports.createNotifyApp = createNotifyApp
exports.createMp3App = createMp3App
exports.startMp3Server = startMp3Server
exports.start = start
