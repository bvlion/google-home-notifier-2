'use strict'

// ngrokのauthtokenなどsecretな値はデフォルトを持たせず必須値として扱う。Google HomeのIPは
// リクエストごとにgooglehome.ip(ip)で切り替える運用を妨げないよう、必須値にはしない。

const DEFAULT_SERVER_PORT = 8091
const DEFAULT_MP3_SERVER_PORT = 8092
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

const resolveTcpPort = (env, name, defaultValue) => {
  if (!env[name]) {
    return defaultValue
  }
  const port = Number(env[name])
  if (!Number.isInteger(port) || port < 1 || port > MAX_TCP_PORT) {
    throw new Error(`環境変数 ${name} には 1〜${MAX_TCP_PORT} の整数を設定してください。`)
  }
  return port
}

const resolveServerPort = (env) => resolveTcpPort(env, 'SERVER_PORT', DEFAULT_SERVER_PORT)

// ngrokはこのポートだけをforwardし、通知用serverPortは公開しない。
const resolveMp3ServerPort = (env) => resolveTcpPort(env, 'MP3_SERVER_PORT', DEFAULT_MP3_SERVER_PORT)

const loadConfig = (env) => {
  const serverPort = resolveServerPort(env)
  const mp3ServerPort = resolveMp3ServerPort(env)

  if (serverPort === mp3ServerPort) {
    throw new Error('環境変数 SERVER_PORT と MP3_SERVER_PORT には異なるポート番号を設定してください(通知用serverとMP3配信用serverの公開範囲を分離できなくなります)。')
  }

  return {
    serverPort,
    mp3ServerPort,
    language: env.TTS_LANGUAGE || DEFAULT_TTS_LANGUAGE,
    voice: env.TTS_VOICE || DEFAULT_TTS_VOICE,
    mp3Url: env.MP3_URL_PATH || DEFAULT_MP3_URL_PATH,
    notifyUrl: env.NOTIFY_URL_PATH || DEFAULT_NOTIFY_URL_PATH,
    mp3OutputPath: env.MP3_OUTPUT_PATH || DEFAULT_MP3_OUTPUT_PATH,
    googleHomeIp: env.GOOGLE_HOME_IP || undefined,
    ngrokAuthtoken: requireEnv(env, 'NGROK_AUTHTOKEN')
  }
}

// 固定1台向けsample runner(main.js)専用の検証。共通設定としては必須ではないためloadConfig()には含めない。
const requireGoogleHomeIp = (config) => {
  if (!config.googleHomeIp) {
    throw new Error('環境変数 GOOGLE_HOME_IP を設定してください(固定1台向けsample runnerのmain.jsを使う場合は必須です。リクエストごとに通知先を切り替えたい場合はscript/以下のカスタムrunnerでgooglehome.ip(ip)を呼び出してください)。')
  }
  return config.googleHomeIp
}

exports.loadConfig = loadConfig
exports.requireGoogleHomeIp = requireGoogleHomeIp
