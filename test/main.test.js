'use strict'

// google-home-notifier-2 は mdns/castv2-client/Text-to-Speech へ実接続するため、
// main.js の HTTP 構成テストでは全体をmockして差し替える(実機・実APIへの接続は不要)。
const mockGooglehome = {
  setUp: jest.fn(),
  ip: jest.fn(),
  volume: jest.fn(),
  play: jest.fn((url, cb) => cb('Device notified')),
  notify: jest.fn((text, cb) => cb('Device notified')),
  ngrokUrl: jest.fn()
}

jest.mock('../google-home-notifier-2', () => mockGooglehome)

const mockNgrokForward = jest.fn()
jest.mock('@ngrok/ngrok', () => ({
  forward: (...args) => mockNgrokForward(...args)
}))

const fs = require('fs')
const os = require('os')
const path = require('path')

const { createNotifyApp, createMp3App, startMp3Server } = require('../main')

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(server))
})

const closeServer = (server) => new Promise((resolve) => {
  if (!server) {
    return resolve()
  }
  server.close(resolve)
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('createNotifyApp() - 通知用app(公開範囲: LAN / localhost想定、ngrokへは公開しない)', () => {
  let server
  let baseUrl

  afterEach(async () => {
    await closeServer(server)
    server = undefined
  })

  const setUpApp = async () => {
    const app = createNotifyApp({
      notifyUrl: '/google-home-notifier',
      googleHomeIp: '192.168.1.50',
      language: 'ja-JP',
      voice: 'ja-JP-Standard-A',
      mp3OutputPath: 'sample.mp3'
    })
    server = await listen(app)
    baseUrl = `http://localhost:${server.address().port}`
  }

  test('POST /google-home-notifier が存在し、既存どおり text=... で通知を受け付ける', async () => {
    await setUpApp()

    const res = await fetch(`${baseUrl}/google-home-notifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent('こんにちは') + '&volume=50'
    })

    expect(res.status).toBe(200)
    expect(mockGooglehome.ip).toHaveBeenCalledWith('192.168.1.50')
    expect(mockGooglehome.volume).toHaveBeenCalledWith(0.5)
    expect(mockGooglehome.notify).toHaveBeenCalledWith('こんにちは', expect.any(Function))
  })

  test('GET /text-mp3 は通知用appには存在しない', async () => {
    await setUpApp()

    const res = await fetch(`${baseUrl}/text-mp3`)

    expect(res.status).toBe(404)
  })
})

describe('createMp3App() - MP3配信用app(公開範囲: ngrokへforwardする対象)', () => {
  let server
  let baseUrl
  let mp3OutputPath

  beforeEach(() => {
    mp3OutputPath = path.join(os.tmpdir(), `main-test-${Date.now()}-${Math.random()}.mp3`)
    fs.writeFileSync(mp3OutputPath, 'dummy-mp3-content')
  })

  afterEach(async () => {
    await closeServer(server)
    server = undefined
    fs.rmSync(mp3OutputPath, { force: true })
  })

  const setUpApp = async () => {
    const app = createMp3App({ mp3Url: '/text-mp3', mp3OutputPath })
    server = await listen(app)
    baseUrl = `http://localhost:${server.address().port}`
  }

  test('GET /text-mp3 が存在し、既存どおりファイルの内容を返す', async () => {
    await setUpApp()

    const res = await fetch(`${baseUrl}/text-mp3`)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toBe('dummy-mp3-content')
  })

  test('POST /google-home-notifier はMP3配信用appには存在しない(ngrok経由で通知POSTへ到達できないことの確認)', async () => {
    await setUpApp()

    const res = await fetch(`${baseUrl}/google-home-notifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent('こんにちは')
    })

    expect(res.status).toBe(404)
  })
})

describe('startMp3Server() - ngrokはMP3配信用serverのポートだけをforwardする', () => {
  let server
  let mp3OutputPath

  beforeEach(() => {
    mp3OutputPath = path.join(os.tmpdir(), `main-test-${Date.now()}-${Math.random()}.mp3`)
    fs.writeFileSync(mp3OutputPath, 'dummy-mp3-content')
    mockNgrokForward.mockResolvedValue({ url: () => 'https://example.ngrok.io' })
  })

  afterEach(async () => {
    await closeServer(server)
    server = undefined
    fs.rmSync(mp3OutputPath, { force: true })
  })

  test('ngrok.forward()にMP3配信用serverのポートが渡され、取得したURL+mp3UrlがgooglehomeのngrokUrl()へ設定される', async () => {
    const mp3App = createMp3App({ mp3Url: '/text-mp3', mp3OutputPath })

    server = await startMp3Server(mp3App, {
      mp3ServerPort: 0,
      mp3Url: '/text-mp3',
      ngrokAuthtoken: 'test-token'
    })
    const assignedPort = server.address().port

    expect(mockNgrokForward).toHaveBeenCalledWith({ addr: 0, authtoken: 'test-token' })
    expect(mockGooglehome.ngrokUrl).toHaveBeenCalledWith('https://example.ngrok.io/text-mp3')

    // 実際にMP3配信用appがlistenしていることも合わせて確認する
    const res = await fetch(`http://localhost:${assignedPort}/text-mp3`)
    expect(res.status).toBe(200)
  })
})
