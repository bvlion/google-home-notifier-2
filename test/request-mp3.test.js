'use strict'

// request-mp3.js は google-home-notifier-2.js / main.js の両方から参照される共通ロジック
// (request固有ファイル/URLの組み立て、cleanupのスケジューリング、起動時の孤児ファイル掃除)のため、
// ここでは実ファイルシステムを使って単体で検証する(実機・実APIへの接続は不要)。

const fs = require('fs')
const os = require('os')
const path = require('path')

describe('request-mp3.js', () => {
  let requestMp3
  let mp3OutputPath
  let createdFiles

  beforeEach(() => {
    jest.resetModules()
    requestMp3 = require('../request-mp3')

    mp3OutputPath = path.join(os.tmpdir(), `request-mp3-test-${Date.now()}-${Math.random()}.mp3`)
    createdFiles = []
  })

  afterEach(() => {
    jest.useRealTimers()
    createdFiles.forEach((filePath) => fs.rmSync(filePath, { force: true }))
  })

  const writeTrackedFile = (filePath, content = 'content') => {
    fs.writeFileSync(filePath, content)
    createdFiles.push(filePath)
    return filePath
  }

  // fake timerで発火させたsetTimeoutコールバック自体は同期的に実行されるが、その中で呼ぶ
  // fs.unlink()は実ファイルシステムに対する非同期I/Oのため、コールバック完了は実イベントループの
  // 後続tickで起こる。fake timerで期限を進めたあとreal timerへ戻し、1tick分だけ実時間で
  // flushすることで、実際に削除が完了したかを確定的に検証する(長時間の実時間待機はしない)。
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

  describe('generateRequestId() / isValidRequestId()', () => {
    test('generateRequestId()は32桁の16進数文字列を生成し、isValidRequestId()はそれを有効と判定する', () => {
      const id = requestMp3.generateRequestId()

      expect(id).toMatch(/^[0-9a-f]{32}$/)
      expect(requestMp3.isValidRequestId(id)).toBe(true)
    })

    test('連続生成したidが重複しない', () => {
      const ids = new Set(Array.from({ length: 20 }, () => requestMp3.generateRequestId()))
      expect(ids.size).toBe(20)
    })

    test.each([
      ['../../../etc/passwd'],
      ['abc/../def'],
      ['not-hex-id'],
      [''],
      ['A'.repeat(32)],
      ['0'.repeat(31)],
      ['0'.repeat(33)],
      [undefined],
      [null],
      [12345]
    ])('不正な値 %p はisValidRequestId()でfalseになる', (value) => {
      expect(requestMp3.isValidRequestId(value)).toBe(false)
    })
  })

  describe('resolveRequestMp3Path()', () => {
    test('mp3OutputPathのディレクトリ・basenameを基準にrequest固有パスを組み立てる', () => {
      const id = requestMp3.generateRequestId()
      const resolved = requestMp3.resolveRequestMp3Path('/tmp/sample.mp3', id)

      expect(resolved).toBe(`/tmp/sample-${id}.mp3`)
    })

    test('拡張子なしのmp3OutputPathでも安全に組み立てられる', () => {
      const id = requestMp3.generateRequestId()
      const resolved = requestMp3.resolveRequestMp3Path('/tmp/sample', id)

      expect(resolved).toBe(`/tmp/sample-${id}.mp3`)
    })

    test('不正な形式のidを渡すと例外を投げ、パスを組み立てない(path traversal防止の最終防衛線)', () => {
      expect(() => requestMp3.resolveRequestMp3Path('/tmp/sample.mp3', '../../etc/passwd')).toThrow()
    })
  })

  describe('appendRequestId()', () => {
    test('クエリなしのURLには"?id="を付与する', () => {
      expect(requestMp3.appendRequestId('https://example.ngrok.io/text-mp3', 'abc123')).toBe(
        'https://example.ngrok.io/text-mp3?id=abc123'
      )
    })

    test('クエリ付きのURLには"&id="を付与する', () => {
      expect(requestMp3.appendRequestId('https://example.ngrok.io/text-mp3?foo=1', 'abc123')).toBe(
        'https://example.ngrok.io/text-mp3?foo=1&id=abc123'
      )
    })

    test('URLがfalsyな場合はそのまま返す', () => {
      expect(requestMp3.appendRequestId(undefined, 'abc123')).toBeUndefined()
      expect(requestMp3.appendRequestId('', 'abc123')).toBe('')
    })
  })

  describe('registerForCleanup() / markServed() - cleanupのスケジューリング(PR #75レビュー対応)', () => {
    test('GETされない(markServed()されない)間は、最大保持時間(MAX_PENDING_TTL_MS)未満ではcleanupされない', () => {
      jest.useFakeTimers()
      const filePath = writeTrackedFile(path.join(os.tmpdir(), `pending-${Date.now()}.mp3`))

      requestMp3.registerForCleanup(filePath)

      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS - 1)
      expect(fs.existsSync(filePath)).toBe(true)
    })

    test('GETされない(markServed()されない)まま最大保持時間(MAX_PENDING_TTL_MS)を過ぎると、最後の砦としてcleanupされる', async () => {
      jest.useFakeTimers()
      const filePath = writeTrackedFile(path.join(os.tmpdir(), `pending-ttl-${Date.now()}.mp3`))

      requestMp3.registerForCleanup(filePath)

      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS)
      jest.useRealTimers()
      await flush()

      expect(fs.existsSync(filePath)).toBe(false)
    })

    test('markServed()を呼ぶと、最大保持時間を待たずGET猶予時間(GET_GRACE_MS)後にcleanupされる', async () => {
      jest.useFakeTimers()
      const filePath = writeTrackedFile(path.join(os.tmpdir(), `served-${Date.now()}.mp3`))

      requestMp3.registerForCleanup(filePath)
      requestMp3.markServed(filePath)

      jest.advanceTimersByTime(requestMp3.GET_GRACE_MS - 1)
      expect(fs.existsSync(filePath)).toBe(true)

      jest.advanceTimersByTime(1)
      jest.useRealTimers()
      await flush()

      expect(fs.existsSync(filePath)).toBe(false)
    })

    test('markServed()を複数回呼んでも、猶予timerは1回分だけ予約される(GET直後の即時削除・リトライ不能を避けつつ、余分に延長もしない)', async () => {
      jest.useFakeTimers()
      const filePath = writeTrackedFile(path.join(os.tmpdir(), `served-twice-${Date.now()}.mp3`))

      requestMp3.registerForCleanup(filePath)
      requestMp3.markServed(filePath)

      jest.advanceTimersByTime(requestMp3.GET_GRACE_MS / 2)
      requestMp3.markServed(filePath) // 2回目のGET(既に猶予timerが動いているため無視される)

      jest.advanceTimersByTime(requestMp3.GET_GRACE_MS / 2)
      jest.useRealTimers()
      await flush()

      expect(fs.existsSync(filePath)).toBe(false)
    })

    test('registerForCleanup()していないfilePathへmarkServed()を呼んでも何も起こらない', () => {
      jest.useFakeTimers()
      expect(() => requestMp3.markServed('/tmp/not-registered.mp3')).not.toThrow()
      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS)
    })

    test('markServed()によるcleanup後、最大保持時間に到達しても二重にunlinkが実行されない', () => {
      jest.useFakeTimers()
      const filePath = writeTrackedFile(path.join(os.tmpdir(), `served-idempotent-${Date.now()}.mp3`))
      const unlinkSpy = jest.spyOn(fs, 'unlink')

      requestMp3.registerForCleanup(filePath)
      requestMp3.markServed(filePath)

      jest.advanceTimersByTime(requestMp3.GET_GRACE_MS)
      expect(unlinkSpy).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS)
      expect(unlinkSpy).toHaveBeenCalledTimes(1)

      unlinkSpy.mockRestore()
    })

    test('registerForCleanup()を同じfilePathへ複数回呼んでも、古いtimerがリークして早期・二重cleanupを起こさない(PR #75レビュー対応: 起動時cleanupからの再登録を想定した保険)', async () => {
      jest.useFakeTimers()
      const filePath = writeTrackedFile(path.join(os.tmpdir(), `double-register-${Date.now()}.mp3`))
      const unlinkSpy = jest.spyOn(fs, 'unlink')

      requestMp3.registerForCleanup(filePath)
      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS / 2)

      // 同じfilePathへ再登録(起動時cleanupが複数回走った場合等を想定した保険的な検証)
      requestMp3.registerForCleanup(filePath)

      // 最初の登録から数えたMAX_PENDING_TTL_MS相当が経過しても、再登録によって期限がリセットされて
      // いるため、まだcleanupされていないこと(古いtimerが生き残って早期cleanupを起こさないこと)
      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS / 2)
      expect(unlinkSpy).not.toHaveBeenCalled()

      // 再登録した時点から数えたMAX_PENDING_TTL_MSが経過すると、cleanupされること(1回だけ)
      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS / 2)
      jest.useRealTimers()
      await flush()

      expect(unlinkSpy).toHaveBeenCalledTimes(1)
      unlinkSpy.mockRestore()
    })

    // Codexレビュー(2026-08-14, discussion_r3779915767)対応: fs.unlink()がEBUSY等で一時的に
    // 失敗しただけでpendingからentryを削除すると、served timer/max timerのどちらもリセットされて
    // いるため二度とretryされず、次回プロセス再起動時のcleanupOrphanedRequestFiles()まで
    // ファイルが残り続ける穴があった。成功またはENOENTの場合にのみpendingから削除し、
    // それ以外は有限回数(UNLINK_RETRY_LIMIT)・一定間隔(UNLINK_RETRY_DELAY_MS)でretryするようにした。
    describe('fs.unlink()失敗時のbounded retry(PR #75レビュー対応)', () => {
      test('fs.unlink()が一時的に失敗しても、bounded retryのうちに成功すれば最終的にcleanupされる', async () => {
        jest.useFakeTimers()
        const filePath = writeTrackedFile(path.join(os.tmpdir(), `retry-success-${Date.now()}.mp3`))
        let callCount = 0
        const unlinkSpy = jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => {
          callCount += 1
          if (callCount < 3) {
            const err = new Error('resource busy or locked')
            err.code = 'EBUSY'
            cb(err)
            return
          }
          fs.unlinkSync(p)
          cb(null)
        })

        requestMp3.registerForCleanup(filePath)
        requestMp3.markServed(filePath)

        // 1回目(GET_GRACE_MS経過時点): 失敗
        jest.advanceTimersByTime(requestMp3.GET_GRACE_MS)
        expect(unlinkSpy).toHaveBeenCalledTimes(1)
        expect(fs.existsSync(filePath)).toBe(true)

        // 2回目(1回目の失敗からUNLINK_RETRY_DELAY_MS後): 失敗
        jest.advanceTimersByTime(requestMp3.UNLINK_RETRY_DELAY_MS)
        expect(unlinkSpy).toHaveBeenCalledTimes(2)
        expect(fs.existsSync(filePath)).toBe(true)

        // 3回目: 成功
        jest.advanceTimersByTime(requestMp3.UNLINK_RETRY_DELAY_MS)
        expect(unlinkSpy).toHaveBeenCalledTimes(3)

        jest.useRealTimers()
        await flush()

        expect(fs.existsSync(filePath)).toBe(false)
        unlinkSpy.mockRestore()
      })

      test('fs.unlink()が繰り返し失敗する場合、無限retryはせずUNLINK_RETRY_LIMIT回で諦める(以後は次回起動時の孤児ファイル掃除に委ねる)', () => {
        jest.useFakeTimers()
        const filePath = writeTrackedFile(path.join(os.tmpdir(), `retry-exhausted-${Date.now()}.mp3`))
        const unlinkSpy = jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => {
          const err = new Error('resource busy or locked')
          err.code = 'EBUSY'
          cb(err)
        })

        requestMp3.registerForCleanup(filePath)
        requestMp3.markServed(filePath)

        jest.advanceTimersByTime(requestMp3.GET_GRACE_MS)
        jest.advanceTimersByTime(requestMp3.UNLINK_RETRY_DELAY_MS * (requestMp3.UNLINK_RETRY_LIMIT - 1))

        expect(unlinkSpy).toHaveBeenCalledTimes(requestMp3.UNLINK_RETRY_LIMIT)

        // retry上限後、さらに時間が経過しても追加のfs.unlink()呼び出しは発生しない(無限retryにしない)
        jest.advanceTimersByTime(requestMp3.UNLINK_RETRY_DELAY_MS * 10)
        expect(unlinkSpy).toHaveBeenCalledTimes(requestMp3.UNLINK_RETRY_LIMIT)
        expect(fs.existsSync(filePath)).toBe(true)

        unlinkSpy.mockRestore()
      })

      test('fs.unlink()がENOENT(既に存在しない)を返した場合は成功扱いとなり、retryせず即cleanup完了とする', async () => {
        jest.useFakeTimers()
        const filePath = writeTrackedFile(path.join(os.tmpdir(), `retry-enoent-${Date.now()}.mp3`))
        fs.rmSync(filePath, { force: true }) // ファイルを先に消しておき、ENOENTを再現する
        const unlinkSpy = jest.spyOn(fs, 'unlink')

        requestMp3.registerForCleanup(filePath)
        requestMp3.markServed(filePath)

        jest.advanceTimersByTime(requestMp3.GET_GRACE_MS)
        jest.useRealTimers()
        await flush()

        expect(unlinkSpy).toHaveBeenCalledTimes(1)

        // ENOENTはretry対象ではないため、さらに時間が経過しても追加呼び出しはない
        jest.useFakeTimers()
        jest.advanceTimersByTime(requestMp3.UNLINK_RETRY_DELAY_MS * requestMp3.UNLINK_RETRY_LIMIT)
        expect(unlinkSpy).toHaveBeenCalledTimes(1)

        unlinkSpy.mockRestore()
      })

      test('fs.unlink()の完了(callback)を待っている間に再度markServed()が呼ばれても、二重にfs.unlink()が呼ばれない(多重cleanup防止)', async () => {
        jest.useFakeTimers()
        const filePath = writeTrackedFile(path.join(os.tmpdir(), `no-double-unlink-${Date.now()}.mp3`))
        let releaseUnlink
        const unlinkSpy = jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => {
          releaseUnlink = () => {
            fs.unlinkSync(p)
            cb(null)
          }
        })

        requestMp3.registerForCleanup(filePath)
        requestMp3.markServed(filePath)

        jest.advanceTimersByTime(requestMp3.GET_GRACE_MS)
        expect(unlinkSpy).toHaveBeenCalledTimes(1)

        // fs.unlink()のcallbackが完了する前(実行中)に、再度markServed()が呼ばれても
        // 二重にfs.unlink()が呼ばれないこと
        requestMp3.markServed(filePath)
        expect(unlinkSpy).toHaveBeenCalledTimes(1)

        releaseUnlink()
        jest.useRealTimers()
        await flush()

        expect(fs.existsSync(filePath)).toBe(false)
        unlinkSpy.mockRestore()
      })
    })
  })

  describe('cleanupOrphanedRequestFiles() - 起動時の孤児ファイル掃除(PR #75レビュー対応: プロセス再起動・クラッシュ後の孤児ファイル)', () => {
    test('十分に古いrequest固有ファイルはcleanupされる', (done) => {
      const id = requestMp3.generateRequestId()
      const orphanPath = writeTrackedFile(requestMp3.resolveRequestMp3Path(mp3OutputPath, id), 'orphan')
      const old = new Date(Date.now() - 1000)
      fs.utimesSync(orphanPath, old, old)
      writeTrackedFile(mp3OutputPath, 'latest')

      requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 500 }, () => {
        expect(fs.existsSync(orphanPath)).toBe(false)
        done()
      })
    })

    test('十分に古いrequest固有の一時ファイル(<request固有ファイル>.tmp)もcleanupされる', (done) => {
      const id = requestMp3.generateRequestId()
      const tmpPath = writeTrackedFile(`${requestMp3.resolveRequestMp3Path(mp3OutputPath, id)}.tmp`, 'tmp')
      const old = new Date(Date.now() - 1000)
      fs.utimesSync(tmpPath, old, old)
      writeTrackedFile(mp3OutputPath, 'latest')

      requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 500 }, () => {
        expect(fs.existsSync(tmpPath)).toBe(false)
        done()
      })
    })

    test('十分に古くないrequest固有ファイルは削除されない(生成直後のファイルを誤って削除しない)', (done) => {
      const id = requestMp3.generateRequestId()
      const freshPath = writeTrackedFile(requestMp3.resolveRequestMp3Path(mp3OutputPath, id), 'fresh')
      writeTrackedFile(mp3OutputPath, 'latest')

      requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 60000 }, () => {
        expect(fs.existsSync(freshPath)).toBe(true)
        done()
      })
    })

    // Codexレビュー(2026-08-14)対応: 起動時cleanupが「まだ新しいので今は削除しない」と判断した
    // request固有MP3が、新プロセスのcleanup管理(pending)には登録されておらず、その後GETされても
    // markServed()がno-opになり、GETされなくても二度と掃除されない(=永久に残り続ける)穴があった。
    // cleanupOrphanedRequestFiles()が見つけた「まだ新しい」ファイルはregisterForCleanup()で
    // 新プロセスのcleanup管理へ登録するようにしたため、以降は通常のrequest固有MP3と同じように
    // GET契機(markServed)またはMAX_PENDING_TTL_MSで必ずcleanupされる。
    test('再起動直後相当の新しいrequest固有MP3は、起動時cleanupでは即削除されないが、新プロセスのcleanup管理へ登録され、その後実際にGETされればGET_GRACE_MS後にcleanupされる', async () => {
      jest.useFakeTimers()

      const id = requestMp3.generateRequestId()
      const freshPath = writeTrackedFile(requestMp3.resolveRequestMp3Path(mp3OutputPath, id), 'fresh')
      writeTrackedFile(mp3OutputPath, 'latest')

      await new Promise((resolve) => {
        requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 60000 }, resolve)
      })

      // 起動直後なので即削除されない
      expect(fs.existsSync(freshPath)).toBe(true)

      // その後、新プロセスでこのファイルへ実際にGETがあったことを模す(main.jsのmarkServed()相当)
      requestMp3.markServed(freshPath)

      jest.advanceTimersByTime(requestMp3.GET_GRACE_MS - 1)
      expect(fs.existsSync(freshPath)).toBe(true)

      jest.advanceTimersByTime(1)
      jest.useRealTimers()
      await flush()

      expect(fs.existsSync(freshPath)).toBe(false)
    })

    test('再起動直後相当の新しいrequest固有MP3がその後GETされなくても、最大保持時間(MAX_PENDING_TTL_MS)経過後には最終的にcleanupされ、永久には残らない', async () => {
      jest.useFakeTimers()

      const id = requestMp3.generateRequestId()
      const freshPath = writeTrackedFile(requestMp3.resolveRequestMp3Path(mp3OutputPath, id), 'fresh')
      writeTrackedFile(mp3OutputPath, 'latest')

      await new Promise((resolve) => {
        requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 60000 }, resolve)
      })

      expect(fs.existsSync(freshPath)).toBe(true)

      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS - 1)
      expect(fs.existsSync(freshPath)).toBe(true)

      jest.advanceTimersByTime(1)
      jest.useRealTimers()
      await flush()

      expect(fs.existsSync(freshPath)).toBe(false)
    })

    test('再起動直後相当の新しい一時ファイル(<request固有ファイル>.tmp)も、起動時cleanupでは即削除されないが、新プロセスのcleanup管理へ登録され、最終的にはcleanupされる(GETされない前提のため最大保持時間経由)', async () => {
      jest.useFakeTimers()

      const id = requestMp3.generateRequestId()
      const freshTmpPath = writeTrackedFile(`${requestMp3.resolveRequestMp3Path(mp3OutputPath, id)}.tmp`, 'fresh-tmp')
      writeTrackedFile(mp3OutputPath, 'latest')

      await new Promise((resolve) => {
        requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 60000 }, resolve)
      })

      expect(fs.existsSync(freshTmpPath)).toBe(true)

      jest.advanceTimersByTime(requestMp3.MAX_PENDING_TTL_MS)
      jest.useRealTimers()
      await flush()

      expect(fs.existsSync(freshTmpPath)).toBe(false)
    })

    test('mp3OutputPath自体は削除しない', (done) => {
      writeTrackedFile(mp3OutputPath, 'latest')

      requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 0 }, () => {
        expect(fs.existsSync(mp3OutputPath)).toBe(true)
        done()
      })
    })

    test('命名規則に一致しない無関係なファイルは削除しない', (done) => {
      const dir = path.dirname(mp3OutputPath)
      const unrelatedPath = writeTrackedFile(path.join(dir, `unrelated-${Date.now()}.mp3`), 'unrelated')
      const old = new Date(Date.now() - 1000)
      fs.utimesSync(unrelatedPath, old, old)
      writeTrackedFile(mp3OutputPath, 'latest')

      requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 500 }, () => {
        expect(fs.existsSync(unrelatedPath)).toBe(true)
        done()
      })
    })

    test('idの形式が不正に近い(桁数不足・大文字)ファイル名は削除対象にしない', (done) => {
      const dir = path.dirname(mp3OutputPath)
      const base = path.basename(mp3OutputPath, '.mp3')
      const nearMissPath = writeTrackedFile(path.join(dir, `${base}-${'A'.repeat(32)}.mp3`), 'near-miss')
      const old = new Date(Date.now() - 1000)
      fs.utimesSync(nearMissPath, old, old)
      writeTrackedFile(mp3OutputPath, 'latest')

      requestMp3.cleanupOrphanedRequestFiles(mp3OutputPath, { minAgeMs: 500 }, () => {
        expect(fs.existsSync(nearMissPath)).toBe(true)
        done()
      })
    })

    test('対象ディレクトリが存在しない場合もクラッシュせず、done()コールバックが呼ばれる', (done) => {
      const missingDirOutputPath = path.join(os.tmpdir(), `no-such-dir-${Date.now()}`, 'sample.mp3')

      expect(() => {
        requestMp3.cleanupOrphanedRequestFiles(missingDirOutputPath, {}, () => {
          done()
        })
      }).not.toThrow()
    })
  })
})
