'use strict'

// Google Home 実機・Google Cloud Text-to-Speech・mDNS ディスカバリへの実接続を避けるため、
// 外部依存はすべて mock/stub に差し替える。

const mockBrowser = {
  start: jest.fn(),
  stop: jest.fn(),
  on: jest.fn()
}

jest.mock('mdns', () => ({
  createBrowser: jest.fn(() => mockBrowser),
  tcp: jest.fn(() => 'tcp')
}), { virtual: true })

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

jest.mock('fs', () => ({
  writeFile: mockWriteFile
}))

describe('google-home-notifier-2', () => {
  let googlehome
  let mockPlayer

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

    googlehome = require('../google-home-notifier-2')
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
        expect(mockBrowser.start).not.toHaveBeenCalled()
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
          '/tmp/sample.mp3',
          Buffer.from('dummy-audio'),
          'binary',
          expect.any(Function)
        )
        expect(mockPlayer.load).toHaveBeenCalledWith(
          expect.objectContaining({ contentId: 'https://example.ngrok.io/text-mp3' }),
          { autoplay: true },
          expect.any(Function)
        )
        expect(res).toBe('Device notified')
        done()
      })
    })

    test('TTS合成に失敗した場合、後続のファイル書き込みや再生は行われずコールバックも呼ばれない', () => {
      mockSynthesizeSpeech.mockImplementation((request, cb) => cb(new Error('tts failed')))
      const callback = jest.fn()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.notify('こんにちは', callback)

      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalled()
    })

    test('音声ファイルの書き込みに失敗した場合、デバイスへの再生は行われずコールバックも呼ばれない', () => {
      mockWriteFile.mockImplementation((path, data, encoding, cb) => cb(new Error('disk full')))
      const callback = jest.fn()

      googlehome.setUp('ja-JP', 'ja-JP-Standard-A', '/tmp/sample.mp3')
      googlehome.ip('192.168.1.50')
      googlehome.notify('こんにちは', callback)

      expect(mockCastClient.connect).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalled()
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
    })
  })
})
