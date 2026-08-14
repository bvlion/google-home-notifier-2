'use strict'

// #73対応: 複数のTTS通知が同時実行された場合に、同一MP3ファイル/同一配信URLへ
// 書き込み・アクセスが競合しないよう、リクエストごとに一意なファイルパスと
// 配信URLを組み立てるための共通ロジック。
// PR #75レビュー対応として、以下もここに集約する。
// - idなしGET(mp3OutputPath直読み)の後方互換を「直近のTTS結果」を指すよう維持する仕組み
// - request固有MP3の実際のGET完了を起点にしたcleanup(固定時間経過だけに頼らない)
// - プロセス再起動・クラッシュでcleanup timer(メモリ状態)が失われた場合の起動時孤児ファイル掃除
// google-home-notifier-2.js(書き込み側)とmain.js(配信側)の両方から参照し、
// ファイル名の組み立てルールが食い違わないようにする。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 内部生成のrequest idのみを受け付ける前提の形式(16byteをhex化した32文字の16進数)。
// HTTPリクエストから受け取ったidはこのpatternで検証してからパス組み立てに使うことで、
// "../" 等によるpath traversalを防ぐ。
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/

// Castデバイスがrequest固有MP3を実際にGETした後、cleanup(削除)するまでの猶予時間。
// GET直後の即時削除によるリトライ不能を避けるため、短い猶予を持たせる。
const GET_GRACE_MS = 10000

// Castデバイスが何らかの理由でGETしなかった場合の、最後の砦としての最大保持時間。
// この時間が経過すれば、GETされていなくてもcleanup対象にする(ファイルが無制限に残り続けないため)。
const MAX_PENDING_TTL_MS = 10 * 60 * 1000

// 起動時の孤児ファイル掃除で、削除対象とみなす最小経過時間。
// プロセス起動直後・実行中に生成されたばかりのファイルを誤って削除しないための安全マージン。
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

// mp3OutputPath(setUp()の第3引数、既定 sample.mp3)の保存ディレクトリ・basenameを基準に、
// リクエスト固有のファイルパスを組み立てる。idは事前にisValidRequestId()で検証済みであること。
const resolveRequestMp3Path = (mp3OutputPath, id) => {
  if (!isValidRequestId(id)) {
    throw new Error(`不正なrequest idです: ${id}`)
  }
  const { dir, base, ext } = splitOutputPath(mp3OutputPath)
  return path.join(dir, `${base}-${id}${ext}`)
}

// このアプリが生成するファイルのうち、起動時cleanupの対象にしてよいものだけにマッチする。
// - request固有MP3:                 <base>-<32桁hex><ext>
// - updateLatestMp3()が使う一時ファイル: <base>-<32桁hex><ext>.tmp
// mp3OutputPath自体や無関係なファイルにはマッチしない。
const orphanCandidatePattern = (mp3OutputPath) => {
  const { base, ext } = splitOutputPath(mp3OutputPath)
  return new RegExp(`^${escapeForRegExp(base)}-[0-9a-f]{32}${escapeForRegExp(ext)}(\\.tmp)?$`)
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

// fs.unlink()がEBUSY等で一時的に失敗しただけでcleanup管理を諦めてpendingから外してしまうと、
// ファイルは残ったままserved timer/max timerのどちらからも二度とretryされなくなり、次回プロセス
// 再起動時のcleanupOrphanedRequestFiles()まで放置されてしまう。そのため、成功またはENOENT
// (既に存在しない=cleanup済みと同等)の場合にのみpendingからentryを削除し、それ以外のエラーでは
// 有限回数(UNLINK_RETRY_LIMIT)・一定間隔(UNLINK_RETRY_DELAY_MS)でretryする。
// 無限retryにはしない: retry上限に達した場合はこのプロセス内での自動retryを諦めるが、
// 次回起動時のcleanupOrphanedRequestFiles()が最終的な安全網になる。
const UNLINK_RETRY_LIMIT = 3
const UNLINK_RETRY_DELAY_MS = 5000

// filePath -> { cleaned, cleaning, maxTimer, servedTimer, retryTimer, onSettled }
// request固有MP3ごとのcleanup状態を保持する。プロセス内メモリのみで管理するため、
// プロセス再起動・クラッシュ時はここでの状態は失われる(その場合の掃除はcleanupOrphanedRequestFiles()が担う)。
const pending = new Map()

const unref = (timer) => {
  if (timer && typeof timer.unref === 'function') {
    timer.unref()
  }
  return timer
}

// entry.cleaning: fs.unlink()の実行中(retry待機中も含む)であることを示すフラグ。
// served timerとmax timerがほぼ同時に発火してrunCleanup()が二重に呼ばれても、cleaning中は
// 何もしないことで並行unlink・二重cleanupを防ぐ。retryを使い切って諦めた場合はfalseへ戻すため、
// (現状の呼び出し経路では通常発生しないが)将来何らかのきっかけで再度cleanupが試みられた場合にも
// retry可能な状態のままになる。
// entry.onSettled: 成功/ENOENT/retry上限到達のいずれかで最終状態に達した時点で一度だけ呼ばれる
// (通常のnotify()由来の登録では未使用。cleanupOrphanedRequestFiles()が「十分古い」孤児ファイルの
// 削除完了を待ってfinishOne()するために利用する)。
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

// notify()がrequest固有MP3の書き込みに成功した直後、または起動時の孤児ファイル掃除
// (cleanupOrphanedRequestFiles())が「まだ新しいので即削除しない」と判断したファイルに対して呼び出す。
// Castが実際にGETしなかった場合の最後の砦として、MAX_PENDING_TTL_MS後には無条件でcleanupする。
// 実際のGET契機のcleanupはmarkServed()が担う(このtimerより先に発火する想定)。
// 同じfilePathへ複数回呼ばれても(呼び出し元での重複登録を想定した保険)、既存のtimerを
// clearTimeout()してから登録し直すため、古いtimerがリークして早期・二重cleanupを起こすことはない。
// onSettledは省略可能(通常のnotify()由来の登録では不要)。cleanupOrphanedRequestFiles()が
// 「十分古い」孤児ファイルの削除完了を検知するために内部的に利用する。
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

// MP3配信用serverが、request固有MP3を実際にGETしたときに呼び出す。
// GET直後の即時削除でリトライ不能にならないよう、GET_GRACE_MS後にcleanupする。
// 未登録(registerForCleanup()を呼んでいない、または既にcleanup済み)のfilePathに対しては何もしない。
// 同じfilePathへ複数回GETがあっても、猶予timerは1回だけ予約する。
const markServed = (filePath) => {
  const entry = pending.get(filePath)
  if (!entry || entry.cleaned || entry.servedTimer) {
    return
  }
  entry.servedTimer = unref(setTimeout(() => runCleanup(filePath), GET_GRACE_MS))
}

// mp3OutputPathの保存ディレクトリ内にある、このアプリが生成した命名規則に一致するファイルを
// 起動時に走査する。mp3OutputPath自体や無関係なファイルは対象にしない。
// - 十分に古い(=プロセス再起動・クラッシュ等でcleanup timer=メモリ上のpendingが失われたとみなせる)
//   ファイルは、通常のcleanupと同じbounded retry機構(registerForCleanup()+runCleanup())に乗せて
//   削除する。EBUSY等でunlinkが一時的に失敗しても、新しく別系統のretryを実装せず、既存の
//   UNLINK_RETRY_LIMIT/UNLINK_RETRY_DELAY_MSでretryする。retry上限に達してもcleanupOrphanedRequestFiles()
//   自体は完了できる(次回起動時のorphan sweepへ委ねる)。
// - まだ新しい(再起動直前に生成された可能性がある)ファイルは即削除せず、代わりに
//   registerForCleanup()で新プロセスのcleanup管理へ登録する。これにより、その後実際にGETされれば
//   markServed()経由でGET_GRACE_MS後に、GETされなくてもMAX_PENDING_TTL_MS後に、最終的には必ず
//   cleanupされる(「新しいので今は消さない」が「cleanup管理から永久に外れる」ことにはならない)。
// finishOne()(=各対象ファイルに対するdone()到達の1件分)は、対象ファイルのcleanupが最終状態
// (成功/ENOENT/retry上限到達、または「まだ新しいので登録のみ」)に達してから呼ぶ。retry timerを
// 予約しただけの時点でfinishOne()してしまうと、done()到達後もまだretryが進行中という意味変更に
// なってしまうため、それは行わない。
// createMp3App()の生成時(=起動時)に一度だけ呼び出す想定。
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
          // 再起動直前に生成された可能性があるため即削除はしないが、cleanup管理からは外さない。
          registerForCleanup(filePath)
          finishOne()
          return
        }
        // 十分古い孤児ファイル: 通常cleanupと同じbounded retry機構に乗せ、最終状態に達してからfinishOne()する。
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
