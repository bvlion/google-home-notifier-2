'use strict'

const { loadConfig, requireGoogleHomeIp } = require('../config')

describe('loadConfig()', () => {
  const requiredEnv = {
    NGROK_AUTHTOKEN: 'test-token'
  }

  test('必須の環境変数のみを指定した場合、その他の値は既存挙動と同じデフォルト値になる', () => {
    const config = loadConfig(requiredEnv)

    expect(config).toEqual({
      serverPort: 8091,
      mp3ServerPort: 8092,
      language: 'ja-JP',
      voice: 'ja-JP-Standard-A',
      mp3Url: '/text-mp3',
      notifyUrl: '/google-home-notifier',
      mp3OutputPath: 'sample.mp3',
      googleHomeIp: undefined,
      ngrokAuthtoken: 'test-token'
    })
  })

  test('環境変数を指定した場合、デフォルト値より優先される', () => {
    const config = loadConfig({
      ...requiredEnv,
      SERVER_PORT: '3000',
      MP3_SERVER_PORT: '3001',
      TTS_LANGUAGE: 'en-US',
      TTS_VOICE: 'en-US-Standard-A',
      MP3_URL_PATH: '/mp3',
      NOTIFY_URL_PATH: '/notify',
      MP3_OUTPUT_PATH: '/tmp/out.mp3',
      GOOGLE_HOME_IP: '192.168.11.100'
    })

    expect(config).toEqual({
      serverPort: 3000,
      mp3ServerPort: 3001,
      language: 'en-US',
      voice: 'en-US-Standard-A',
      mp3Url: '/mp3',
      notifyUrl: '/notify',
      mp3OutputPath: '/tmp/out.mp3',
      googleHomeIp: '192.168.11.100',
      ngrokAuthtoken: 'test-token'
    })
  })

  test('GOOGLE_HOME_IP はアプリケーション全体の必須設定ではなく、未設定でもエラーにならない', () => {
    const config = loadConfig(requiredEnv)

    expect(config.googleHomeIp).toBeUndefined()
  })

  test('NGROK_AUTHTOKEN が未設定の場合はエラーになる', () => {
    expect(() => loadConfig({ GOOGLE_HOME_IP: '192.168.11.100' }))
      .toThrow('環境変数 NGROK_AUTHTOKEN を設定してください。')
  })

  test('SERVER_PORT が数値でない場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, SERVER_PORT: 'abc' }))
      .toThrow('環境変数 SERVER_PORT には 1〜65535 の整数を設定してください。')
  })

  test('SERVER_PORT が 0 以下の場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, SERVER_PORT: '0' }))
      .toThrow('環境変数 SERVER_PORT には 1〜65535 の整数を設定してください。')
  })

  test('SERVER_PORT が TCPポートの上限(65535)の場合は有効な値として扱われる', () => {
    const config = loadConfig({ ...requiredEnv, SERVER_PORT: '65535' })

    expect(config.serverPort).toBe(65535)
  })

  test('SERVER_PORT が TCPポートの上限(65535)を超える場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, SERVER_PORT: '65536' }))
      .toThrow('環境変数 SERVER_PORT には 1〜65535 の整数を設定してください。')
  })

  test('MP3_SERVER_PORT を指定しない場合、デフォルト値(8092)になる', () => {
    const config = loadConfig(requiredEnv)

    expect(config.mp3ServerPort).toBe(8092)
  })

  test('MP3_SERVER_PORT を指定した場合、その値が使われる', () => {
    const config = loadConfig({ ...requiredEnv, MP3_SERVER_PORT: '9000' })

    expect(config.mp3ServerPort).toBe(9000)
  })

  test('MP3_SERVER_PORT が数値でない場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, MP3_SERVER_PORT: 'abc' }))
      .toThrow('環境変数 MP3_SERVER_PORT には 1〜65535 の整数を設定してください。')
  })

  test('MP3_SERVER_PORT が範囲外(0以下、65535超)の場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, MP3_SERVER_PORT: '0' }))
      .toThrow('環境変数 MP3_SERVER_PORT には 1〜65535 の整数を設定してください。')
    expect(() => loadConfig({ ...requiredEnv, MP3_SERVER_PORT: '65536' }))
      .toThrow('環境変数 MP3_SERVER_PORT には 1〜65535 の整数を設定してください。')
  })

  test('SERVER_PORT と MP3_SERVER_PORT に同じ値を指定した場合はエラーになる(公開範囲の分離が成立しないため)', () => {
    expect(() => loadConfig({ ...requiredEnv, SERVER_PORT: '9000', MP3_SERVER_PORT: '9000' }))
      .toThrow('環境変数 SERVER_PORT と MP3_SERVER_PORT には異なるポート番号を設定してください')
  })
})

describe('requireGoogleHomeIp()', () => {
  test('GOOGLE_HOME_IP が設定されている場合、その値を返す(固定1台向けsample runnerでの利用)', () => {
    const config = loadConfig({ NGROK_AUTHTOKEN: 'test-token', GOOGLE_HOME_IP: '192.168.11.100' })

    expect(requireGoogleHomeIp(config)).toBe('192.168.11.100')
  })

  test('GOOGLE_HOME_IP が未設定の場合はエラーになる(config.js全体は必須にしないが、sample runner側で要求する)', () => {
    const config = loadConfig({ NGROK_AUTHTOKEN: 'test-token' })

    expect(() => requireGoogleHomeIp(config))
      .toThrow('環境変数 GOOGLE_HOME_IP を設定してください')
  })
})
