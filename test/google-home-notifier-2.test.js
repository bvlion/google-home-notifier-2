'use strict'

// Google Home 実機・Google Cloud Text-to-Speech・mDNS ディスカバリへの実接続を避けるため、
// 外部依存はすべて mock/stub に差し替える。

// createGoogleCastBrowser(onUp)は、bonjour-serviceのfind(opts, onUp)にあわせて
// onUpをコールバック引数として受け取り、探索を開始済みのbrowser(start()/on()相当は
// 呼び出し側で行わない)を返す。テスト側はmockImplementationで渡されたonUpを捕捉し、
// 任意のタイミングでservice発見を模擬する(mdns-browser.js / google-home-notifier-2.js参照)。
const mockBrowser = {
  stop: jest.fn()
}

const mockCreateGoogleCastBrowser = jest.fn(() => mockBrowser)

jest.mock('../mdns-browser', () => ({
  createGoogleCastBrowser: mockCreateGoogleCastBrowser
}))

const mockCastClient = {
  connect: jest.fn(),
  getVolume: jest.fn(),
  setVolume: jest.fn(),
  launch: jest.fn(),
  close: jest.fn(),
  on: jest.fn()
}

jest.mock('castv2-client', () => ({
  Client: jest.fn(() => mockCastClient),
  DefaultMediaReceiver: 'DefaultMediaReceiver'
}))

const mockSynthesizeSpeech = jest.fn()
const mockTextToSpeechClient = jest.fn(() => ({
  synthesizeSpeech: mockSynthesizeSpeech
}))

jest.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: mockTextToSpeechClient
}))

// jest.resetModules() によってモジュールレジストリがリセットされるたびに、
// jest.mock の factory は再実行される。factory 内で毎回新しい jest.fn() を
// 生成すると、テストファイル側が保持する参照とソース側が実際に require する
// 参照がずれてしまうため、永続する mock 関数をここで定義して参照を固定する。
const mockWriteFile = jest.fn()
const mockUnlink = jest.fn()
const mockCopyFile = jest.fn()
const mockRename = jest.fn()

jest.mock('fs', () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
  copyFile: mockCopyFile,
  rename: mockRename
}))

const { GET_GRACE_MS, MAX_PENDING_TTL_MS } = require('../request-mp3')

// setUp()のmp3OutputPathを基準に組み立てられる、リクエスト固有ファイルパスの形式
// (例: /tmp/first.mp3 -> /tmp/first-<32桁hex>.mp3)。
const REQUEST_PATH_PATTERN = (basePath) => {
  const dir = basePath.slice(0, basePath.lastIndexOf('/') + 1)
  const withoutExt = basePath.slice(basePath.lastIndexOf('/') + 1, basePath.lastIndexOf('.'))
  const ext = basePath.slice(basePath.lastIndexOf('.'))
  return new RegExp(`^${dir}${withoutExt}-[0-9a-f]{32}${ext}$`)
}

// ngrokUrl()で設定した固定URLを基準に組み立てられる、リクエスト固有配信URLの形式
// (例: https://example.ngrok.io/text-mp3 -> https://example.ngrok.io/text-mp3?id=<32桁hex>)。
const REQUEST_URL_PATTERN = (baseUrl) =>
  new RegExp(`^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?id=[0-9a-f]{32}$`)

describe('google-home-notifier-2', () => {
  let googlehome
  let mockPlayer
  // jest.resetModules() のたびに request-mp3.js も新しいモジュールインスタンス(=新しいpending Map)が
  // require されるため、markServed() はテストファイル先頭で一度だけ require したものではなく、
  // 直近の require('../google-home-notifier-2') が内部で参照しているのと同じインスタンスを都度取得する。
  let markServed

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    mockPlayer = { load: jest.fn((media, opts, cb) => cb(null, {})) }

    mockCastClient.connect.mockImplementation((host, cb) => cb())
    mockCastClient.getVolume.mockImplementation((cb) => cb(null, {}))
    mockCastClient.setVolume.mockImplementation((opts, cb) => cb(null, {}))
    mockCastClient.launch.mockImplementation((receiver, cb) => cb(null, mockPlayer))
    mockCastClient.on.mockImplementation(() => {})

    mockSynthesizeSpeech.mockImplementation((request, cb) =>
      cb(null, { audioContent: Buffer.from('dummy-audio') })
    )

    mockWriteFile.mockImplementation((path, data, encoding, cb) => cb(null))
    mockUnlink.mockImplementation((path, cb) => cb(null))
    mockCopyFile.mockImplementation((src, dest, cb) => cb(null))
    mockRename.mockImplementation((src, dest, cb) => cb(null))

    googlehome = require('../google-home-notifier-2')
    ;({ markServed } = require('../request-mp3'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Text-to-Speechクライアントの認証', () => {
    test('script/target.json 等の固定パス指定を行わず、引数なしでクライアントを生成する(Google Cloud標準のADCに委ねる)', () => {
      expect(mockTextToSpeechClient).toHaveBeenCalledTimes(1)
      expect(mockTextToSpeechClient).toHaveBeenCalledWith()
    })
  })

  describe('ip()', () => {
    test('デバイスIPが設定されている場合、mDNSディスカバリを行わずデバイスへ直接接続する', (done) => {
      googlehome.ip('192.168.1.50')

      googlehome.play('http://example.com/audio.mp3', () => {
        expect(mockCreateGoogleCastBrowser).not.toHaveBeenCalled()
        expect(mockCastClient.connect).toHaveBeenCalledWith('192.168.1.50', expect.any(Function))
        done()
      })
    })

    test('リクエストごとに異なるIPを指定した場合、それぞれ直近に指定したIPへ再生される(複数デバイスへの通知先切り替え)', (done) => {
      googlehome.ip('192.168.1.50')

      googlehome.play('http://example.com/audio1.mp3', () => {
        expect(mockCastClient.connect).toHaveBeenNthCalledWith(1, '192.168.1.50', expect.any(Function))

        googlehome.ip('192.168.1.99')

        googlehome.play('http://example.com/audio2.mp3', () => {
          expect(mockCastClient.connect).toHaveBeenNthCalledWith(2, '192.168.1.99', expect.any(Function))
          expect(mockCastClient.connect).toHaveBeenCalledTimes(2)
          done()
        })
      })
    })
  })

  describe('device()', () => {
    test('IP未指定時、device()で設定した名前を含むmDNSサービスが見つかったデバイスへ接続する(派生元にあった公開APIの復元)', (done) => {
      let onUp
      mockCreateGoogleCastBrowser.mockImplementation((handler) => {
        onUp = handler
        return mockBrowser
      })

      googlehome.device('Living Room')
      googlehome.play('http://example.com/audio.mp3', (res) => {
        expect(mockCastClient.connect).toHaveBeenCalledWith('192.168.1.77', expect.any(Function))
        expect(res).toBe('Device notified')
        done()
      })

      expect(mockCreateGoogleCastBrowser).toHaveBeenCalledWith(expect.any(Function))
      onUp({
        name: 'Living-Room-ABCD',
        addresses: ['192.168.1.77'],
        port: 8009
      })
    })

    test('device()で設定した名前を含まないmDNSサービスは無視され、探索を停止しない', () => {
      let onUp
      mockCreateGoogleCastBrowser.mockImplementation((handler) => {
        onUp = handler
        return mockBrowser
      })

      googlehome.device('Living Room')
      googlehome.play('http://example.com/audio.mp3', jest.fn())

      onUp({
        name: 'Kitchen-ABCD',
        addresses: ['192.168.1.88'],
        port: 8009
      })

      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(mockBrowser.stop).not.toHaveBeenCalled()
    })

    test('対象外デバイスが先にserviceが見つかっても探索を継続し、後から見つかった対象デバイスへ接続する(複数デバイス環境での探索打ち切り防止)', (done) => {
      let onUp
      mockCreateGoogleCastBrowser.mockImplementation((handler) => {
        onUp = handler
        return mockBrowser
      })

      googlehome.device('Living Room')
      googlehome.play('http://example.com/audio.mp3', (res) => {
        expect(mockCastClient.connect).toHaveBeenCalledWith('192.168.1.77', expect.any(Function))
        expect(mockCastClient.connect).toHaveBeenCalledTimes(1)
        expect(res).toBe('Device notified')
        done()
      })

      // 対象外デバイスが先に見つかっても探索を打ち切らないこと
      onUp({
        name: 'Kitchen-ABCD',
        addresses: ['192.168.1.88'],
        port: 8009
      })
      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(mockBrowser.stop).not.toHaveBeenCalled()

      // その後、対象デバイスが見つかれば接続されること
      onUp({
        name: 'Living-Room-ABCD',
        addresses: ['192.168.1.77'],
        port: 8009
      })
      expect(mockBrowser.stop).toHaveBeenCalledTimes(1)
    })

    test('mDNS探索中に別リクエストがsetUp()/ngrokUrl()を呼び出しても、notify()呼び出し時点の設定値が使用される(並行リクエストによる上書き防止)', (done) => {
      let onUp
      mockCreateGoogleCastBrowser.mockImplementation((handler) => {
        onUp = handler
        return mockBrowser
      })

      googlehome.device('Living Room')
      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/first.mp3')
      googlehome.ngrokUrl('https://first.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', (res) => {
        expect(mockSynthesizeSpeech).toHaveBeenCalledWith(
          expect.objectContaining({
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Standard-A' }
          }),
          expect.any(Function)
        )
        expect(mockWriteFile).toHaveBeenCalledWith(
          expect.stringMatching(REQUEST_PATH_PATTERN('/tmp/first.mp3')),
          expect.any(Buffer),
          'binary',
          expect.any(Function)
        )
        expect(mockPlayer.load).toHaveBeenCalledWith(
          expect.objectContaining({ contentId: expect.stringMatching(REQUEST_URL_PATTERN('https://first.ngrok.io/text-mp3')) }),
          { autoplay: true },
          expect.any(Function)
        )
        expect(res).toBe('Device notified')
        done()
      })

      // serviceが見つかる前に別リクエストがsetUp()/ngrokUrl()を呼び出したことを模す
      googlehome.setUp('en-US', 'en-US-Standard-A', '/tmp/second.mp3')
      googlehome.ngrokUrl('https://second.ngrok.io/text-mp3')

      onUp({
        name: 'Living-Room-ABCD',
        addresses: ['192.168.1.77'],
        port: 8009
      })
    })
  })

  describe('mDNS discoveryのlifecycle(PR #83 Codex P1レビュー対応: bonjour-serviceのfind()はbrowser生成と同時に探索を開始するため、旧mdnsパッケージ前提のstart()/on()呼び出し順に依存しないことを保証する)', () => {
    test('google-home-notifier-2 moduleをrequireしただけではmDNS discoveryを開始しない(createGoogleCastBrowserを呼び出さない)', () => {
      // beforeEach で require 済み。ここでは追加の呼び出しを一切行わず、require時点の状態のみ検証する。
      expect(mockCreateGoogleCastBrowser).not.toHaveBeenCalled()
    })

    test('device()を呼び出しただけ(notify()/play()を呼ぶ前)ではmDNS discoveryを開始しない', () => {
      googlehome.device('Living Room')

      expect(mockCreateGoogleCastBrowser).not.toHaveBeenCalled()
    })

    test('ip()明示指定のnotify()/play()ではmDNS browserを生成しない(discoveryを開始しない)', (done) => {
      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', () => {
        expect(mockCreateGoogleCastBrowser).not.toHaveBeenCalled()
        done()
      })
    })

    test('device()経路では、notify()/play()呼び出しで実際に探索が必要になった時点で初めてmDNS discoveryを開始する', () => {
      googlehome.device('Living Room')
      expect(mockCreateGoogleCastBrowser).not.toHaveBeenCalled()

      googlehome.play('http://example.com/audio.mp3', jest.fn())
      expect(mockCreateGoogleCastBrowser).toHaveBeenCalledTimes(1)
    })

    test('createGoogleCastBrowser()呼び出し中(bonjour-serviceのfind()相当)に同期的にserviceが見つかっても、up handlerは既に登録済みのため対象serviceへ正常に接続し、callbackが完了する', (done) => {
      // bonjour-serviceのBonjour#find(opts, onUp)は、Browser constructor内でonUpを
      // this.start()より先にon('up', onUp)登録してから探索を開始する実装のため、
      // 呼び出し側(createGoogleCastBrowser)がonUpを渡した直後(理論上の最速タイミング)に
      // serviceが見つかっても取りこぼさない。この最悪ケースをfind()呼び出し中に同期的に
      // onUpを発火させることで再現する。
      mockCreateGoogleCastBrowser.mockImplementation((handler) => {
        handler({
          name: 'Living-Room-ABCD',
          addresses: ['192.168.1.77'],
          port: 8009
        })
        return mockBrowser
      })

      googlehome.device('Living Room')
      googlehome.play('http://example.com/audio.mp3', (res) => {
        expect(mockCastClient.connect).toHaveBeenCalledWith('192.168.1.77', expect.any(Function))
        expect(res).toBe('Device notified')
        done()
      })
    })

    test('並行して2つのmDNS探索(device()経路)が走っている場合、一方が対象deviceを発見してstop()しても、もう一方の探索は継続し正しく接続できる(createGoogleCastBrowser()の呼び出しごとに独立したbrowserを生成するため。PR #83 Codex P2レビュー対応の回帰)', (done) => {
      const browserA = { stop: jest.fn() }
      const browserB = { stop: jest.fn() }
      let onUpA
      let onUpB
      mockCreateGoogleCastBrowser
        .mockImplementationOnce((handler) => {
          onUpA = handler
          return browserA
        })
        .mockImplementationOnce((handler) => {
          onUpB = handler
          return browserB
        })

      googlehome.device('Living Room')

      let completed = 0
      const finishIfBothDone = () => {
        completed += 1
        if (completed === 2) {
          done()
        }
      }

      googlehome.play('http://example.com/audio-a.mp3', (res) => {
        expect(res).toBe('Device notified')
        finishIfBothDone()
      })
      googlehome.play('http://example.com/audio-b.mp3', (res) => {
        expect(res).toBe('Device notified')
        finishIfBothDone()
      })

      expect(mockCreateGoogleCastBrowser).toHaveBeenCalledTimes(2)

      // Aの探索が先に対象deviceを発見してstopする
      onUpA({
        name: 'Living-Room-ABCD',
        addresses: ['192.168.1.77'],
        port: 8009
      })
      expect(browserA.stop).toHaveBeenCalledTimes(1)
      expect(browserB.stop).not.toHaveBeenCalled()

      // Bの探索はAのstop()の影響を受けず継続しており、対象deviceを発見すれば接続できる
      onUpB({
        name: 'Living-Room-EFGH',
        addresses: ['192.168.1.78'],
        port: 8009
      })
      expect(browserB.stop).toHaveBeenCalledTimes(1)
    })
  })

  describe('volume()', () => {
    test('有効な範囲(0.0〜1.0)の値はデバイスの音量設定に反映される', (done) => {
      googlehome.ip('192.168.1.50')
      googlehome.volume(0.5)

      googlehome.play('http://example.com/audio.mp3', () => {
        expect(mockCastClient.setVolume).toHaveBeenCalledWith({ level: 0.5 }, expect.any(Function))
        done()
      })
    })

    test('範囲外の値(0.0未満または1.0超)は無視され、直前に設定した有効な音量が維持される', (done) => {
      googlehome.ip('192.168.1.50')
      googlehome.volume(0.3)
      googlehome.volume(1.5)
      googlehome.volume(-0.1)

      googlehome.play('http://example.com/audio.mp3', () => {
        expect(mockCastClient.setVolume).toHaveBeenCalledWith({ level: 0.3 }, expect.any(Function))
        expect(mockCastClient.setVolume).toHaveBeenCalledTimes(1)
        done()
      })
    })

    test('0.0はJavaScriptのfalsy判定により音量設定がスキップされる(既存挙動)', (done) => {
      googlehome.ip('192.168.1.50')
      googlehome.volume(0.5)
      googlehome.volume(0.0)

      googlehome.play('http://example.com/audio.mp3', () => {
        expect(mockCastClient.setVolume).not.toHaveBeenCalled()
        done()
      })
    })

    test('接続中にvolume()が別の値へ変更されても、play()呼び出し時点のvolumeが使用される(並行リクエストによる上書き防止)', (done) => {
      let connectCallback
      mockCastClient.connect.mockImplementation((host, cb) => { connectCallback = cb })

      googlehome.ip('192.168.1.50')
      googlehome.volume(0.2)
      googlehome.play('http://example.com/audio.mp3', () => {
        expect(mockCastClient.setVolume).toHaveBeenCalledWith({ level: 0.2 }, expect.any(Function))
        done()
      })

      // 別リクエストが接続中にvolume()を呼び出したことを模す
      googlehome.volume(0.9)

      connectCallback()
    })
  })

  describe('play()', () => {
    test('URLをそのままデバイスに再生させ、TTSは呼び出さない', (done) => {
      googlehome.ip('192.168.1.50')

      googlehome.play('http://example.com/audio.mp3', (res) => {
        expect(mockSynthesizeSpeech).not.toHaveBeenCalled()
        expect(mockWriteFile).not.toHaveBeenCalled()
        expect(mockPlayer.load).toHaveBeenCalledWith(
          expect.objectContaining({
            contentId: 'http://example.com/audio.mp3',
            contentType: 'audio/mp3'
          }),
          { autoplay: true },
          expect.any(Function)
        )
        expect(res).toBe('Device notified')
        done()
      })
    })
  })

  describe('notify()', () => {
    test('setUp()の言語・音声・ngrokUrlの設定値がTTSリクエストと再生URLに反映される', (done) => {
      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', (res) => {
        expect(mockSynthesizeSpeech).toHaveBeenCalledWith(
          expect.objectContaining({
            input: { text: 'こんにちは' },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Standard-A' }
          }),
          expect.any(Function)
        )
        expect(mockWriteFile).toHaveBeenCalledWith(
          expect.stringMatching(REQUEST_PATH_PATTERN('/tmp/sample.mp3')),
          Buffer.from('dummy-audio'),
          'binary',
          expect.any(Function)
        )
        expect(mockPlayer.load).toHaveBeenCalledWith(
          expect.objectContaining({ contentId: expect.stringMatching(REQUEST_URL_PATTERN('https://example.ngrok.io/text-mp3')) }),
          { autoplay: true },
          expect.any(Function)
        )
        expect(res).toBe('Device notified')
        done()
      })
    })

    test('TTS合成に失敗した場合、後続のファイル書き込みや再生は行われず、コールバックへ"error"が渡される', () => {
      mockSynthesizeSpeech.mockImplementation((request, cb) => cb(new Error('tts failed')))
      const callback = jest.fn()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.notify('こんにちは', callback)

      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith('error')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test('音声ファイルの書き込みに失敗した場合、デバイスへの再生は行われず、コールバックへ"error"が渡される', () => {
      mockWriteFile.mockImplementation((path, data, encoding, cb) => cb(new Error('disk full')))
      const callback = jest.fn()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.notify('こんにちは', callback)

      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith('error')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test('TTS合成中にsetUp()のaudioFilePathが別の値へ変更されても、notify()呼び出し時点のパスへ書き込まれる(並行リクエストによる上書き防止)', (done) => {
      let synthCallback
      mockSynthesizeSpeech.mockImplementation((request, cb) => { synthCallback = cb })

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/first.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.notify('こんにちは', () => {
        expect(mockWriteFile).toHaveBeenCalledWith(
          expect.stringMatching(REQUEST_PATH_PATTERN('/tmp/first.mp3')),
          expect.any(Buffer),
          'binary',
          expect.any(Function)
        )
        done()
      })

      // 別リクエストがTTS合成中にsetUp()を呼び出したことを模す
      googlehome.setUp('en-US', 'en-US-Standard-A', '/tmp/second.mp3')

      synthCallback(null, { audioContent: Buffer.from('dummy-audio') })
    })

    test('TTS合成中にngrokUrl()が別の値へ変更されても、notify()呼び出し時点のURLが再生される(並行リクエストによる上書き防止)', (done) => {
      let synthCallback
      mockSynthesizeSpeech.mockImplementation((request, cb) => { synthCallback = cb })

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://first.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', () => {
        expect(mockPlayer.load).toHaveBeenCalledWith(
          expect.objectContaining({ contentId: expect.stringMatching(REQUEST_URL_PATTERN('https://first.ngrok.io/text-mp3')) }),
          { autoplay: true },
          expect.any(Function)
        )
        done()
      })

      // 別リクエストがTTS合成中にngrokUrl()を呼び出したことを模す
      googlehome.ngrokUrl('https://second.ngrok.io/text-mp3')

      synthCallback(null, { audioContent: Buffer.from('dummy-audio') })
    })
  })

  describe('デバイス接続エラー', () => {
    test('castv2-clientがエラーイベントを発火した場合、コールバックに"error"が渡される', () => {
      let errorHandler
      mockCastClient.connect.mockImplementation(() => {
        // 実機接続を模した非同期処理: ここでは成功コールバックを呼ばず、エラーのみ後で発火させる
      })
      mockCastClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler
        }
      })

      const callback = jest.fn()
      googlehome.ip('192.168.1.50')
      googlehome.play('http://example.com/audio.mp3', callback)

      errorHandler(new Error('connection refused'))

      expect(callback).toHaveBeenCalledWith('error')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test('receiverのlaunchに失敗した場合、コールバックに"error"が渡される', () => {
      mockCastClient.launch.mockImplementation((receiver, cb) => cb(new Error('launch failed')))
      const callback = jest.fn()

      googlehome.ip('192.168.1.50')
      googlehome.play('http://example.com/audio.mp3', callback)

      expect(mockPlayer.load).not.toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith('error')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test('player.loadに失敗した場合、コールバックに"error"が渡される', () => {
      mockPlayer.load.mockImplementation((media, opts, cb) => cb(new Error('load failed')))
      const callback = jest.fn()

      googlehome.ip('192.168.1.50')
      googlehome.play('http://example.com/audio.mp3', callback)

      expect(callback).toHaveBeenCalledWith('error')
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test('getVolume/setVolumeが失敗しても、再生自体は成功として扱われる(音量設定は補助的な処理のため)', (done) => {
      mockCastClient.getVolume.mockImplementation((cb) => cb(new Error('getVolume failed')))
      googlehome.ip('192.168.1.50')
      googlehome.volume(0.5)

      googlehome.play('http://example.com/audio.mp3', (res) => {
        expect(mockCastClient.setVolume).not.toHaveBeenCalled()
        expect(res).toBe('Device notified')
        done()
      })
    })

    test('再生成功のコールバックが呼ばれた後にclientの"error"イベントが発火しても、コールバックは再度呼ばれない(二重呼び出し防止)', (done) => {
      let errorHandler
      mockCastClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler
        }
      })

      const callback = jest.fn((res) => {
        expect(res).toBe('Device notified')
        errorHandler(new Error('connection dropped after success'))
        expect(callback).toHaveBeenCalledTimes(1)
        done()
      })

      googlehome.ip('192.168.1.50')
      googlehome.play('http://example.com/audio.mp3', callback)
    })
  })

  describe('同時実行されたnotify()同士の競合(#73)', () => {
    test('2つのnotify()をほぼ同時に実行し、TTS callbackが任意の順序で完了しても、それぞれ異なるファイル/URLへ書き込まれ、対応するaudioContentと正しく対応し、両方のcallbackが正常に完了する', (done) => {
      const synthCalls = []
      mockSynthesizeSpeech.mockImplementation((request, cb) => {
        synthCalls.push({ text: request.input.text, cb })
      })

      const writtenFiles = []
      mockWriteFile.mockImplementation((path, data, encoding, cb) => {
        writtenFiles.push({ path, data })
        cb(null)
      })

      const loadedUrls = []
      mockPlayer.load.mockImplementation((media, opts, cb) => {
        loadedUrls.push(media.contentId)
        cb(null)
      })

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      const results = []
      const finishIfDone = () => {
        if (results.length !== 2) {
          return
        }

        // 書き込み先ファイル・再生URLがそれぞれ異なること(同一ファイル/URLへの競合がないこと)
        expect(writtenFiles.length).toBe(2)
        expect(writtenFiles[0].path).not.toBe(writtenFiles[1].path)
        expect(loadedUrls.length).toBe(2)
        expect(loadedUrls[0]).not.toBe(loadedUrls[1])

        const extractId = (value) => (value.match(/([0-9a-f]{32})/) || [])[1]

        // 書き込まれたファイルのidと、Castへ渡されたURLのidが1件ずつ対応していること
        // (完了順に処理されるため、writtenFiles[i]とloadedUrls[i]が同一リクエストの結果になる)
        expect(extractId(writtenFiles[0].path)).toBe(extractId(loadedUrls[0]))
        expect(extractId(writtenFiles[1].path)).toBe(extractId(loadedUrls[1]))
        expect(extractId(writtenFiles[0].path)).not.toBe(extractId(writtenFiles[1].path))

        // 各ファイルの中身が、そのリクエストのTTS audioContentと対応していること
        // (通知Bを先に完了させたため、書き込み順は B, A の順になる)
        expect(writtenFiles[0].data.toString()).toBe('audio-B')
        expect(writtenFiles[1].data.toString()).toBe('audio-A')

        expect(results).toEqual(expect.arrayContaining([
          { label: 'A', res: 'Device notified' },
          { label: 'B', res: 'Device notified' }
        ]))

        done()
      }

      googlehome.notify('通知A', (res) => {
        results.push({ label: 'A', res })
        finishIfDone()
      })
      googlehome.notify('通知B', (res) => {
        results.push({ label: 'B', res })
        finishIfDone()
      })

      expect(synthCalls.length).toBe(2)

      // 任意の順序(ここではB→A)でTTS callbackが完了しても競合しないことを確認する
      synthCalls[1].cb(null, { audioContent: Buffer.from('audio-B') })
      synthCalls[0].cb(null, { audioContent: Buffer.from('audio-A') })
    })
  })

  describe('一時MP3ファイルのcleanup(#73 / PR #75レビュー対応)', () => {
    test('MP3配信用serverから実際にGETされた通知(markServed)がない限り、GET猶予時間(GET_GRACE_MS)相当が経過してもcleanupされない。GETされないまま最大保持時間(MAX_PENDING_TTL_MS)を過ぎると最後の砦としてcleanupされる(player.load()のcallbackタイミングだけに依存しない)', (done) => {
      jest.useFakeTimers()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', (res) => {
        expect(res).toBe('Device notified')

        // Cast側のGETがまだ完了した通知(markServed)を受けていない間は、
        // GET猶予時間相当が経過してもcleanupされない(#73レビュー: 固定60秒だけに頼らない)
        jest.advanceTimersByTime(GET_GRACE_MS)
        expect(mockUnlink).not.toHaveBeenCalled()

        // GETされないまま最大保持時間に達すると、最後の砦としてcleanupされる
        jest.advanceTimersByTime(MAX_PENDING_TTL_MS)
        expect(mockUnlink).toHaveBeenCalledTimes(1)
        expect(mockUnlink).toHaveBeenCalledWith(
          expect.stringMatching(REQUEST_PATH_PATTERN('/tmp/sample.mp3')),
          expect.any(Function)
        )
        done()
      })
    })

    test('MP3配信用serverが実際にGETしたことをmarkServed()で通知すると、最大保持時間を待たずGET猶予時間後にcleanupされる', (done) => {
      jest.useFakeTimers()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', () => {
        const [writtenPath] = mockWriteFile.mock.calls[0]

        // MP3配信用serverがGETした(main.jsのcreateMp3App()がmarkServed()を呼ぶ)ことを模す
        markServed(writtenPath)

        expect(mockUnlink).not.toHaveBeenCalled()
        jest.advanceTimersByTime(GET_GRACE_MS)

        expect(mockUnlink).toHaveBeenCalledTimes(1)
        expect(mockUnlink).toHaveBeenCalledWith(writtenPath, expect.any(Function))

        // 最大保持時間まで進めても、二重にcleanupが実行されない(runCleanup()の冪等性)
        jest.advanceTimersByTime(MAX_PENDING_TTL_MS)
        expect(mockUnlink).toHaveBeenCalledTimes(1)
        done()
      })
    })

    test('cleanup(unlink)が失敗しても、既に完了しているnotify()のcallbackは再発火せず、正常な通知結果に影響しない', (done) => {
      jest.useFakeTimers()
      mockUnlink.mockImplementation((path, cb) => cb(new Error('cleanup failed')))

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      const callback = jest.fn()
      googlehome.notify('こんにちは', callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('Device notified')

      jest.advanceTimersByTime(MAX_PENDING_TTL_MS)

      // cleanup失敗後もcallbackが再度呼ばれていないこと
      expect(callback).toHaveBeenCalledTimes(1)
      done()
    })
  })

  describe('idなしGETの後方互換(mp3OutputPath自体の更新, PR #75レビュー対応)', () => {
    test('TTS成功時、request固有ファイルの内容がmp3OutputPath(idなしGET用)へatomicに反映される(コピー後rename)', (done) => {
      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', () => {
        const [requestPath] = mockWriteFile.mock.calls[0]
        const expectedTmpPath = `${requestPath}.tmp`

        expect(mockCopyFile).toHaveBeenCalledWith(requestPath, expectedTmpPath, expect.any(Function))
        expect(mockRename).toHaveBeenCalledWith(expectedTmpPath, '/tmp/sample.mp3', expect.any(Function))
        done()
      })
    })

    test('Cast接続に失敗しても、TTS/書き込み自体は成功しているためmp3OutputPathへの反映は行われる', (done) => {
      let errorHandler
      mockCastClient.connect.mockImplementation(() => {})
      mockCastClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler
        }
      })

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', (res) => {
        expect(res).toBe('error')
        expect(mockCopyFile).toHaveBeenCalledWith(
          expect.stringMatching(REQUEST_PATH_PATTERN('/tmp/sample.mp3')),
          expect.stringMatching(/\.tmp$/),
          expect.any(Function)
        )
        expect(mockRename).toHaveBeenCalledWith(expect.any(String), '/tmp/sample.mp3', expect.any(Function))
        done()
      })

      errorHandler(new Error('connection refused'))
    })

    test('TTS合成に失敗した場合はmp3OutputPathの更新も行われない', () => {
      mockSynthesizeSpeech.mockImplementation((request, cb) => cb(new Error('tts failed')))
      const callback = jest.fn()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.notify('こんにちは', callback)

      expect(mockCopyFile).not.toHaveBeenCalled()
      expect(mockRename).not.toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith('error')
    })

    test('2回連続でnotify()が成功すると、mp3OutputPathは2回目の内容で上書きされる(rename()で毎回置き換わる)', (done) => {
      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('1回目', () => {
        googlehome.notify('2回目', () => {
          expect(mockRename).toHaveBeenCalledTimes(2)
          expect(mockRename).toHaveBeenNthCalledWith(1, expect.any(String), '/tmp/sample.mp3', expect.any(Function))
          expect(mockRename).toHaveBeenNthCalledWith(2, expect.any(String), '/tmp/sample.mp3', expect.any(Function))
          done()
        })
      })
    })

    test('copyFileが失敗しても、mp3OutputPathへの反映処理は完了扱いとなり後続のCast処理・notify callbackは実行される', (done) => {
      mockCopyFile.mockImplementation((src, dest, cb) => cb(new Error('copy failed')))

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', (res) => {
        expect(res).toBe('Device notified')
        expect(mockRename).not.toHaveBeenCalled()
        done()
      })
    })

    test('renameが失敗しても、tmpファイルのcleanup後にCast処理・notify callbackは実行される', (done) => {
      mockRename.mockImplementation((src, dest, cb) => cb(new Error('rename failed')))

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      googlehome.notify('こんにちは', (res) => {
        expect(res).toBe('Device notified')
        expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), expect.any(Function))
        done()
      })
    })

    // PR #75レビュー(2回目)対応: updateLatestMp3()はfs.copyFile()→fs.rename()という非同期処理のため、
    // これらのcallbackが完了する前にCast処理(onDeviceUp)やnotify()のcallbackへ進んでしまうと、
    // 元実装(fs.writeFile()完了後にのみCast処理へ進む)と順序が異なり、idなしGETがmp3OutputPathの
    // rename完了前に古い内容を読みうるレースが残る。copyFile/renameのcallbackを意図的に保留し、
    // それらが完了するまでCast接続・notify callbackが実行されないことを直接確認する。
    test('mp3OutputPathへの反映(copyFile→rename)が完了するまで、Cast接続やnotify()のcallbackは実行されない(順序維持のレース防止)', () => {
      let copyFileCallback
      let renameCallback
      mockCopyFile.mockImplementation((src, dest, cb) => {
        copyFileCallback = cb
      })
      mockRename.mockImplementation((src, dest, cb) => {
        renameCallback = cb
      })

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      const callback = jest.fn()
      googlehome.notify('こんにちは', callback)

      // copyFile完了前: Cast接続もnotify callbackもまだ行われていないこと
      expect(mockCopyFile).toHaveBeenCalledTimes(1)
      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalled()

      // copyFile成功 → rename開始。rename完了前もまだCast処理は始まらないこと
      copyFileCallback(null)
      expect(mockRename).toHaveBeenCalledTimes(1)
      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalled()

      // rename成功 → ここでようやくCast処理・notify callbackへ進むこと
      renameCallback(null)

      expect(mockCastClient.connect).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('Device notified')
    })

    test('mp3OutputPathへの反映中にcopyFileが失敗しても、その時点でCast接続・notify callbackへ進む(hangしない)', () => {
      let copyFileCallback
      mockCopyFile.mockImplementation((src, dest, cb) => {
        copyFileCallback = cb
      })

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      const callback = jest.fn()
      googlehome.notify('こんにちは', callback)

      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalled()

      copyFileCallback(new Error('copy failed'))

      expect(mockRename).not.toHaveBeenCalled()
      expect(mockCastClient.connect).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('Device notified')
    })

    test('callbackは(copyFile/rename失敗時も含め)最大1回しか呼ばれない', () => {
      mockCopyFile.mockImplementation((src, dest, cb) => cb(new Error('copy failed')))

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.ngrokUrl('https://example.ngrok.io/text-mp3')

      const callback = jest.fn()
      googlehome.notify('こんにちは', callback)

      expect(callback).toHaveBeenCalledTimes(1)
    })
  })
})
