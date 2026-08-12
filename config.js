'use strict'

// main.js が利用する外部設定値(環境変数)を解決する。
// Google Home の IP や ngrok の authtoken など環境固有・secretな値は、
// 実値のデフォルトを持たせず必須値として扱う。

const DEFAULT_SERVER_PORT = 8091
const MAX_TCP_PORT = 65535
const DEFAULT_TTS_LANGUAGE = 'ja-JP'
const DEFAULT_TTS_VOICE = 'ja-JP-Standard-A'
const DEFAULT_MP3_URL_PATH = '/text-mp3'
const DEFAULT_NOTIFY_URL_PATH = '/google-home-notifier'
const DEFAULT_MP3_OUTPUT_PATH = 'sample.mp3'

const requireEnv = (env, name) => {
  const value = env[name]
  if (!value) {
    throw new Error(`環境変数 ${name} を設定してください。`)
  }
  return value
}

const resolveServerPort = (env) => {
  if (!env.SERVER_PORT) {
    return DEFAULT_SERVER_PORT
  }
  const port = Number(env.SERVER_PORT)
  if (!Number.isInteger(port) || port < 1 || port > MAX_TCP_PORT) {
    throw new Error(`環境変数 SERVER_PORT には 1〜${MAX_TCP_PORT} の整数を設定してください。`)
  }
  return port
}

const loadConfig = (env) => ({
  serverPort: resolveServerPort(env),
  language: env.TTS_LANGUAGE || DEFAULT_TTS_LANGUAGE,
  voice: env.TTS_VOICE || DEFAULT_TTS_VOICE,
  mp3Url: env.MP3_URL_PATH || DEFAULT_MP3_URL_PATH,
  notifyUrl: env.NOTIFY_URL_PATH || DEFAULT_NOTIFY_URL_PATH,
  mp3OutputPath: env.MP3_OUTPUT_PATH || DEFAULT_MP3_OUTPUT_PATH,
  googleHomeIp: requireEnv(env, 'GOOGLE_HOME_IP'),
  ngrokAuthtoken: requireEnv(env, 'NGROK_AUTHTOKEN')
})

exports.loadConfig = loadConfig
