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
const net = require('net')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { createNotifyApp, createMp3App, startMp3Server } = require('../main')
const { resolveRequestMp3Path } = require('../request-mp3')

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

  test('notify()のコールバックへ"error"が渡された場合、HTTP responseは500で完了する', async () => {
    mockGooglehome.notify.mockImplementationOnce((text, cb) => cb('error'))
    await setUpApp()

    const res = await fetch(`${baseUrl}/google-home-notifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent('こんにちは')
    })

    expect(res.status).toBe(500)
  })

  test('play()のコールバックへ"error"が渡された場合、HTTP responseは500で完了する', async () => {
    mockGooglehome.play.mockImplementationOnce((url, cb) => cb('error'))
    await setUpApp()

    const res = await fetch(`${baseUrl}/google-home-notifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent('http://example.com/audio.mp3')
    })

    expect(res.status).toBe(500)
  })

  test('notify()呼び出しが同期的に例外を投げても、二重response(ERR_HTTP_HEADERS_SENT)にならずHTTP responseが完了する', async () => {
    mockGooglehome.notify.mockImplementationOnce(() => {
      throw new Error('synchronous failure')
    })
    await setUpApp()

    const res = await fetch(`${baseUrl}/google-home-notifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent('こんにちは')
    })

    expect(res.status).toBe(500)
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

  test('MP3ファイルが存在しない場合、GET /text-mp3 は404でHTTP responseが完了する', async () => {
    fs.rmSync(mp3OutputPath, { force: true })
    await setUpApp()

    const res = await fetch(`${baseUrl}/text-mp3`)

    expect(res.status).toBe(404)
  })
})

describe('createMp3App() - リクエスト固有MP3の配信(#73: 同時に複数の一時MP3が存在していても対応するファイルだけを返す)', () => {
  let server
  let baseUrl
  let mp3OutputPath
  let idA
  let idB
  let pathA
  let pathB

  beforeEach(() => {
    mp3OutputPath = path.join(os.tmpdir(), `main-test-${Date.now()}-${Math.random()}.mp3`)
    fs.writeFileSync(mp3OutputPath, 'dummy-mp3-content')

    idA = crypto.randomBytes(16).toString('hex')
    idB = crypto.randomBytes(16).toString('hex')
    pathA = resolveRequestMp3Path(mp3OutputPath, idA)
    pathB = resolveRequestMp3Path(mp3OutputPath, idB)
    fs.writeFileSync(pathA, 'content-A')
    fs.writeFileSync(pathB, 'content-B')
  })

  afterEach(async () => {
    await closeServer(server)
    server = undefined
    fs.rmSync(mp3OutputPath, { force: true })
    fs.rmSync(pathA, { force: true })
    fs.rmSync(pathB, { force: true })
  })

  const setUpApp = async () => {
    const app = createMp3App({ mp3Url: '/text-mp3', mp3OutputPath })
    server = await listen(app)
    baseUrl = `http://localhost:${server.address().port}`
  }

  test('idAのURLはAのMP3を返し、idBのURLはBのMP3を返す', async () => {
    await setUpApp()

    const resA = await fetch(`${baseUrl}/text-mp3?id=${idA}`)
    const resB = await fetch(`${baseUrl}/text-mp3?id=${idB}`)

    expect(resA.status).toBe(200)
    expect(await resA.text()).toBe('content-A')
    expect(resB.status).toBe(200)
    expect(await resB.text()).toBe('content-B')
  })

  test('存在しない(形式は正しい)idへのアクセスは404になる', async () => {
    await setUpApp()
    const missingId = crypto.randomBytes(16).toString('hex')

    const res = await fetch(`${baseUrl}/text-mp3?id=${missingId}`)

    expect(res.status).toBe(404)
  })

  test.each([
    ['../../../etc/passwd'],
    ['..%2f..%2fetc%2fpasswd'],
    ['abc/../def'],
    ['not-hex-id'],
    [''],
    ['A'.repeat(32)], // 大文字は許可されたhex形式ではない
    ['0'.repeat(31)] // 桁数不足
  ])('不正な形式のid "%s" はpath traversal等につながらず400エラーになる', async (badId) => {
    await setUpApp()

    const res = await fetch(`${baseUrl}/text-mp3?id=${encodeURIComponent(badId)}`)

    expect(res.status).toBe(400)
  })

  test('id指定なしの場合は既存どおりmp3OutputPathを返す(後方互換。mp3OutputPath自体はgoogle-home-notifier-2.js側で直近のTTS結果へ更新され続ける前提)', async () => {
    await setUpApp()

    const res = await fetch(`${baseUrl}/text-mp3`)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('dummy-mp3-content')
  })

  test('request固有ファイルをGETすると、以後cleanup対象としてmarkされる(main.js内でmarkServed()が呼ばれる。実際の削除タイミング自体はrequest-mp3.test.jsで確認する)', async () => {
    await setUpApp()

    const resBefore = await fetch(`${baseUrl}/text-mp3?id=${idA}`)
    expect(resBefore.status).toBe(200)

    // markServed()はrequest-mp3.js内のpending Mapに登録されたfilePathに対してのみ意味を持つ。
    // このテストでは直接registerForCleanup()していないため、markServed()自体は安全にno-opになるが、
    // GET自体が(idの検証・ファイル読み取りも含めて)例外なく完了することを確認する。
    const resAfter = await fetch(`${baseUrl}/text-mp3?id=${idA}`)
    expect(resAfter.status).toBe(200)
    expect(await resAfter.text()).toBe('content-A')
  })
})

describe('createMp3App() - 起動時の孤児ファイル掃除(PR #75レビュー対応: プロセス再起動・クラッシュ後もrequest固有MP3が残り続けない)', () => {
  let server
  let mp3OutputPath
  let orphanRequestPath
  let orphanTmpPath
  let freshRequestPath

  beforeEach(() => {
    mp3OutputPath = path.join(os.tmpdir(), `main-test-orphan-${Date.now()}-${Math.random()}.mp3`)
    fs.writeFileSync(mp3OutputPath, 'dummy-mp3-content')

    // プロセス再起動・クラッシュ等でcleanup timer(メモリ状態)が失われた「十分に古い」孤児ファイルを模す
    const oldId = crypto.randomBytes(16).toString('hex')
    orphanRequestPath = resolveRequestMp3Path(mp3OutputPath, oldId)
    fs.writeFileSync(orphanRequestPath, 'orphaned-content')
    orphanTmpPath = `${orphanRequestPath}.tmp`
    fs.writeFileSync(orphanTmpPath, 'orphaned-tmp-content')
    const old = new Date(Date.now() - 5 * 60 * 1000)
    fs.utimesSync(orphanRequestPath, old, old)
    fs.utimesSync(orphanTmpPath, old, old)

    // 起動直後・実行中に生成されたばかりの「まだ現役の可能性がある」ファイルは削除されないことも確認する
    const freshId = crypto.randomBytes(16).toString('hex')
    freshRequestPath = resolveRequestMp3Path(mp3OutputPath, freshId)
    fs.writeFileSync(freshRequestPath, 'fresh-content')
  })

  afterEach(async () => {
    await closeServer(server)
    server = undefined
    fs.rmSync(mp3OutputPath, { force: true })
    fs.rmSync(orphanRequestPath, { force: true })
    fs.rmSync(orphanTmpPath, { force: true })
    fs.rmSync(freshRequestPath, { force: true })
  })

  const waitUntil = async (predicate, timeoutMs = 1000) => {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('timed out waiting for condition')
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  test('createMp3App()の生成時に、古いrequest固有MP3・一時ファイル(孤児)はcleanupされ、mp3OutputPath自体と生成直後のファイルは残る', async () => {
    const app = createMp3App({ mp3Url: '/text-mp3', mp3OutputPath })
    server = await listen(app)

    await waitUntil(() => !fs.existsSync(orphanRequestPath) && !fs.existsSync(orphanTmpPath))

    expect(fs.existsSync(orphanRequestPath)).toBe(false)
    expect(fs.existsSync(orphanTmpPath)).toBe(false)
    expect(fs.existsSync(mp3OutputPath)).toBe(true)
    expect(fs.existsSync(freshRequestPath)).toBe(true)
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

  test('ngrok.forward()が失敗した場合、Promiseがrejectされる(Unhandled rejection/Promise未完了にならない)', async () => {
    mockNgrokForward.mockRejectedValue(new Error('ngrok forward failed'))
    const mp3App = createMp3App({ mp3Url: '/text-mp3', mp3OutputPath })

    await expect(
      startMp3Server(mp3App, { mp3ServerPort: 0, mp3Url: '/text-mp3', ngrokAuthtoken: 'test-token' })
    ).rejects.toThrow('ngrok forward failed')
  })

  test('MP3配信用serverのlistenに失敗した場合、Promiseがrejectされる(Promise未完了にならない)', async () => {
    const blocker = net.createServer()
    await new Promise((resolve) => blocker.listen(0, resolve))
    const blockedPort = blocker.address().port

    const mp3App = createMp3App({ mp3Url: '/text-mp3', mp3OutputPath })

    await expect(
      startMp3Server(mp3App, { mp3ServerPort: blockedPort, mp3Url: '/text-mp3', ngrokAuthtoken: 'test-token' })
    ).rejects.toThrow()

    await new Promise((resolve) => blocker.close(resolve))
  })
})
