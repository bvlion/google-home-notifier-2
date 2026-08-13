'use strict'

// #73対応: 複数のTTS通知が同時実行された場合に、同一MP3ファイル/同一配信URLへ
// 書き込み・アクセスが競合しないよう、リクエストごとに一意なファイルパスと
// 配信URLを組み立てるための共通ロジック。
// google-home-notifier-2.js(書き込み側)とmain.js(配信側)の両方から参照し、
// ファイル名の組み立てルールが食い違わないようにする。

const path = require('path')
const crypto = require('crypto')

// 内部生成のrequest idのみを受け付ける前提の形式(16byteをhex化した32文字の16進数)。
// HTTPリクエストから受け取ったidはこのpatternで検証してからパス組み立てに使うことで、
// "../" 等によるpath traversalを防ぐ。
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/

// Castデバイスが一時MP3を取得するまでの猶予時間。この時間が経過してからcleanup(削除)する。
const CLEANUP_DELAY_MS = 60000

const generateRequestId = () => crypto.randomBytes(16).toString('hex')

const isValidRequestId = (id) => typeof id === 'string' && REQUEST_ID_PATTERN.test(id)

// mp3OutputPath(setUp()の第3引数、既定 sample.mp3)の保存ディレクトリ・basenameを基準に、
// リクエスト固有のファイルパスを組み立てる。idは事前にisValidRequestId()で検証済みであること。
const resolveRequestMp3Path = (mp3OutputPath, id) => {
  if (!isValidRequestId(id)) {
    throw new Error(`不正なrequest idです: ${id}`)
  }
  const dir = path.dirname(mp3OutputPath)
  const ext = path.extname(mp3OutputPath) || '.mp3'
  const base = path.basename(mp3OutputPath, ext)
  return path.join(dir, `${base}-${id}${ext}`)
}

// ngrokUrl()で設定された固定URL(例: https://xxxx.ngrok.io/text-mp3)へ、
// このリクエストのidをクエリパラメータとして付与する。
const appendRequestId = (url, id) => {
  if (!url) {
    return url
  }
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}id=${id}`
}

exports.REQUEST_ID_PATTERN = REQUEST_ID_PATTERN
exports.CLEANUP_DELAY_MS = CLEANUP_DELAY_MS
exports.generateRequestId = generateRequestId
exports.isValidRequestId = isValidRequestId
exports.resolveRequestMp3Path = resolveRequestMp3Path
exports.appendRequestId = appendRequestId
