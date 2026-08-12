'use strict'

const { loadConfig } = require('../config')

describe('loadConfig()', () => {
  const requiredEnv = {
    GOOGLE_HOME_IP: '192.168.11.100',
    NGROK_AUTHTOKEN: 'test-token'
  }

  test('必須の環境変数のみを指定した場合、その他の値は既存挙動と同じデフォルト値になる', () => {
    const config = loadConfig(requiredEnv)

    expect(config).toEqual({
      serverPort: 8091,
      language: 'ja-JP',
      voice: 'ja-JP-Standard-A',
      mp3Url: '/text-mp3',
      notifyUrl: '/google-home-notifier',
      mp3OutputPath: 'sample.mp3',
      googleHomeIp: '192.168.11.100',
      ngrokAuthtoken: 'test-token'
    })
  })

  test('環境変数を指定した場合、デフォルト値より優先される', () => {
    const config = loadConfig({
      ...requiredEnv,
      SERVER_PORT: '3000',
      TTS_LANGUAGE: 'en-US',
      TTS_VOICE: 'en-US-Standard-A',
      MP3_URL_PATH: '/mp3',
      NOTIFY_URL_PATH: '/notify',
      MP3_OUTPUT_PATH: '/tmp/out.mp3'
    })

    expect(config).toEqual({
      serverPort: 3000,
      language: 'en-US',
      voice: 'en-US-Standard-A',
      mp3Url: '/mp3',
      notifyUrl: '/notify',
      mp3OutputPath: '/tmp/out.mp3',
      googleHomeIp: '192.168.11.100',
      ngrokAuthtoken: 'test-token'
    })
  })

  test('GOOGLE_HOME_IP が未設定の場合はエラーになる', () => {
    expect(() => loadConfig({ NGROK_AUTHTOKEN: 'test-token' }))
      .toThrow('環境変数 GOOGLE_HOME_IP を設定してください。')
  })

  test('NGROK_AUTHTOKEN が未設定の場合はエラーになる', () => {
    expect(() => loadConfig({ GOOGLE_HOME_IP: '192.168.11.100' }))
      .toThrow('環境変数 NGROK_AUTHTOKEN を設定してください。')
  })

  test('SERVER_PORT が数値でない場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, SERVER_PORT: 'abc' }))
      .toThrow('環境変数 SERVER_PORT には正の整数を設定してください。')
  })

  test('SERVER_PORT が 0 以下の場合はエラーになる', () => {
    expect(() => loadConfig({ ...requiredEnv, SERVER_PORT: '0' }))
      .toThrow('環境変数 SERVER_PORT には正の整数を設定してください。')
  })
})
