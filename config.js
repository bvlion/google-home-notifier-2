'use strict'

// main.js が利用する外部設定値(環境変数)を解決する。
// ngrok の authtoken など secret な値は、実値のデフォルトを持たせず必須値として扱う。
// Google Home の IP はリクエストごとに googlehome.ip(ip) で切り替える運用を妨げないよう、
// アプリケーション全体の必須値にはしない(固定1台向けサンプルrunnerでのみ任意に使う)。

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
  // 固定の1台のみに通知する用途のリポジトリ直下 main.js が任意で使う値。
  // リクエストごとに googlehome.ip(ip) で通知先を切り替える運用(カスタムrunner)では不要なため、
  // アプリケーション全体の必須値にはしない。要否は利用側(sample runnerなら requireGoogleHomeIp())で判断する。
  googleHomeIp: env.GOOGLE_HOME_IP || undefined,
  ngrokAuthtoken: requireEnv(env, 'NGROK_AUTHTOKEN')
})

// 固定1台向けsample runner(リポジトリ直下 main.js)専用の検証。
// googleHomeIp はライブラリ/共通設定としては必須ではないため loadConfig() には含めず、
// GOOGLE_HOME_IP を必要とする利用側だけがこの関数で明示的に検証する。
const requireGoogleHomeIp = (config) => {
  if (!config.googleHomeIp) {
    throw new Error('環境変数 GOOGLE_HOME_IP を設定してください(固定1台向けsample runnerのmain.jsを使う場合は必須です。リクエストごとに通知先を切り替えたい場合はscript/以下のカスタムrunnerでgooglehome.ip(ip)を呼び出してください)。')
  }
  return config.googleHomeIp
}

exports.loadConfig = loadConfig
exports.requireGoogleHomeIp = requireGoogleHomeIp
