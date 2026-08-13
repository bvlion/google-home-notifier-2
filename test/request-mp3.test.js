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
    // fake timerで発火させたsetTimeoutコールバック自体は同期的に実行されるが、その中で呼ぶ
    // fs.unlink()は実ファイルシステムに対する非同期I/Oのため、コールバック完了は実イベントループの
    // 後続tickで起こる。fake timerで期限を進めたあとreal timerへ戻し、1tick分だけ実時間で
    // flushすることで、実際に削除が完了したかを確定的に検証する(60秒等の長時間の実時間待機はしない)。
    const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

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
