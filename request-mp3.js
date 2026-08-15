'use strict'

// google-home-notifier-2.js(書き込み側)とmain.js(配信側)で共有し、request固有MP3の
// ファイル名組み立てルールが食い違わないようにする。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 内部生成のrequest id(16byteをhex化した32文字)のみを受け付ける形式。HTTPリクエストから
// 受け取ったidはこのpatternで検証してからパス組み立てに使い、path traversalを防ぐ。
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/

// GET直後の即時削除でリトライ不能にならないための猶予時間。
const GET_GRACE_MS = 10000

// Castデバイスが何らかの理由でGETしなかった場合の、最後の砦としての最大保持時間。
const MAX_PENDING_TTL_MS = 10 * 60 * 1000

// 起動時の孤児ファイル掃除で、起動直前に生成された可能性があるファイルを
// 誤って削除しないための最小経過時間。
const ORPHAN_MIN_AGE_MS = 60 * 1000

const generateRequestId = () => crypto.randomBytes(16).toString('hex')

const isValidRequestId = (id) => typeof id === 'string' && REQUEST_ID_PATTERN.test(id)

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const splitOutputPath = (mp3OutputPath) => {
  const ext = path.extname(mp3OutputPath) || '.mp3'
  const base = path.basename(mp3OutputPath, ext)
  const dir = path.dirname(mp3OutputPath)
  return { dir, base, ext }
}

const resolveRequestMp3Path = (mp3OutputPath, id) => {
  if (!isValidRequestId(id)) {
    throw new Error(`不正なrequest idです: ${id}`)
  }
  const { dir, base, ext } = splitOutputPath(mp3OutputPath)
  return path.join(dir, `${base}-${id}${ext}`)
}

// request固有MP3(<base>-<32桁hex><ext>)とそのtmpファイルにのみマッチする。
// mp3OutputPath自体や無関係なファイルは対象にしない。
const orphanCandidatePattern = (mp3OutputPath) => {
  const { base, ext } = splitOutputPath(mp3OutputPath)
  return new RegExp(`^${escapeForRegExp(base)}-[0-9a-f]{32}${escapeForRegExp(ext)}(\\.tmp)?$`)
}

const appendRequestId = (url, id) => {
  if (!url) {
    return url
  }
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}id=${id}`
}

// ENOENT以外のunlink失敗は有限回数・一定間隔でretryする。retry上限に達しても諦めるだけで、
// 次回起動時のcleanupOrphanedRequestFiles()が最終的な安全網になる。
const UNLINK_RETRY_LIMIT = 3
const UNLINK_RETRY_DELAY_MS = 5000

// filePath -> { cleaned, cleaning, maxTimer, servedTimer, retryTimer, onSettled }
// プロセス内メモリのみで管理するため、プロセス再起動・クラッシュで状態は失われる
// (その場合の掃除はcleanupOrphanedRequestFiles()が担う)。
const pending = new Map()

const unref = (timer) => {
  if (timer && typeof timer.unref === 'function') {
    timer.unref()
  }
  return timer
}

// entry.cleaning: unlink実行中(retry待機中含む)は、served/max timerが同時発火してrunCleanup()が
// 二重に呼ばれても何もしない(並行unlinkを防ぐ)。
const attemptUnlink = (filePath, attempt) => {
  fs.unlink(filePath, (err) => {
    const entry = pending.get(filePath)
    if (!entry) {
      return
    }
    if (!err || err.code === 'ENOENT') {
      entry.cleaned = true
      entry.cleaning = false
      pending.delete(filePath)
      if (entry.onSettled) {
        entry.onSettled()
      }
      return
    }

    console.error('ERROR:', err)

    if (attempt >= UNLINK_RETRY_LIMIT) {
      entry.cleaning = false
      const onSettled = entry.onSettled
      entry.onSettled = null
      if (onSettled) {
        onSettled()
      }
      return
    }

    entry.retryTimer = unref(setTimeout(() => attemptUnlink(filePath, attempt + 1), UNLINK_RETRY_DELAY_MS))
  })
}

const runCleanup = (filePath) => {
  const entry = pending.get(filePath)
  if (!entry || entry.cleaned || entry.cleaning) {
    return
  }
  entry.cleaning = true
  clearTimeout(entry.maxTimer)
  if (entry.servedTimer) {
    clearTimeout(entry.servedTimer)
  }
  attemptUnlink(filePath, 1)
}

// 同じfilePathへ複数回呼ばれても、既存のtimerをclearTimeout()してから登録し直すため、
// 古いtimerがリークして早期・二重cleanupを起こすことはない。
const registerForCleanup = (filePath, onSettled) => {
  const existing = pending.get(filePath)
  if (existing) {
    clearTimeout(existing.maxTimer)
    if (existing.servedTimer) {
      clearTimeout(existing.servedTimer)
    }
    if (existing.retryTimer) {
      clearTimeout(existing.retryTimer)
    }
  }
  pending.set(filePath, {
    cleaned: false,
    cleaning: false,
    servedTimer: null,
    retryTimer: null,
    onSettled: onSettled || null,
    maxTimer: unref(setTimeout(() => runCleanup(filePath), MAX_PENDING_TTL_MS))
  })
}

const markServed = (filePath) => {
  const entry = pending.get(filePath)
  if (!entry || entry.cleaned || entry.servedTimer) {
    return
  }
  entry.servedTimer = unref(setTimeout(() => runCleanup(filePath), GET_GRACE_MS))
}

// プロセス再起動・クラッシュでcleanup timer(メモリ上のpending)が失われたrequest固有MP3を
// 起動時に掃除する。十分古いファイルは通常cleanupと同じbounded retry機構に乗せて削除し、
// まだ新しい(再起動直前に生成された可能性がある)ファイルは即削除せずcleanup管理へ登録するだけにする。
const cleanupOrphanedRequestFiles = (mp3OutputPath, options = {}, done = () => {}) => {
  const minAgeMs = options.minAgeMs !== undefined ? options.minAgeMs : ORPHAN_MIN_AGE_MS
  const { dir } = splitOutputPath(mp3OutputPath)
  const pattern = orphanCandidatePattern(mp3OutputPath)

  fs.readdir(dir, (err, entries) => {
    if (err) {
      console.error('ERROR:', err)
      done()
      return
    }

    const targets = entries.filter((entry) => pattern.test(entry))
    if (targets.length === 0) {
      done()
      return
    }

    let remaining = targets.length
    const finishOne = () => {
      remaining -= 1
      if (remaining === 0) {
        done()
      }
    }

    targets.forEach((entry) => {
      const filePath = path.join(dir, entry)
      fs.stat(filePath, (err, stat) => {
        if (err) {
          if (err.code !== 'ENOENT') {
            console.error('ERROR:', err)
          }
          finishOne()
          return
        }
        if (Date.now() - stat.mtimeMs < minAgeMs) {
          registerForCleanup(filePath)
          finishOne()
          return
        }
        registerForCleanup(filePath, finishOne)
        runCleanup(filePath)
      })
    })
  })
}

exports.REQUEST_ID_PATTERN = REQUEST_ID_PATTERN
exports.GET_GRACE_MS = GET_GRACE_MS
exports.MAX_PENDING_TTL_MS = MAX_PENDING_TTL_MS
exports.ORPHAN_MIN_AGE_MS = ORPHAN_MIN_AGE_MS
exports.UNLINK_RETRY_LIMIT = UNLINK_RETRY_LIMIT
exports.UNLINK_RETRY_DELAY_MS = UNLINK_RETRY_DELAY_MS
exports.generateRequestId = generateRequestId
exports.isValidRequestId = isValidRequestId
exports.resolveRequestMp3Path = resolveRequestMp3Path
exports.appendRequestId = appendRequestId
exports.registerForCleanup = registerForCleanup
exports.markServed = markServed
exports.cleanupOrphanedRequestFiles = cleanupOrphanedRequestFiles
