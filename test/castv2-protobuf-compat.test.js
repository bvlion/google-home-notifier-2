'use strict'

// package.jsonのoverridesでcastv2配下のprotobufjsをcastv2本来の宣言(^6.8.8)から
// 7系(^7.6.5)へ引き上げている(Issue #84)。castv2自体はコード変更されていないため、
// 実際にインストールされているcastv2 / protobufjsとcastv2同梱のcast_channel.protoを使い、
// CastMessageのserialize/deserializeがoverride後も成立することを継続的に担保する。
// protobufjs自体の正しさを検証する目的ではない。

const path = require('path')
const protobuf = require('protobufjs')

describe('castv2 + protobufjs override互換性 (Issue #84)', () => {
  test('overrideで解決されたprotobufjsが7系であること', () => {
    const installedVersion = require('protobufjs/package.json').version
    expect(installedVersion.split('.')[0]).toBe('7')
  })

  test('castv2同梱のcast_channel.protoからCastMessageをlookupTypeできること', async () => {
    const protoPath = path.join(
      path.dirname(require.resolve('castv2/package.json')),
      'lib',
      'cast_channel.proto'
    )

    const root = await protobuf.load(protoPath)
    const CastMessage = root.lookupType('extensions.api.cast_channel.CastMessage')

    expect(CastMessage).toBeDefined()
  })

  test('CastMessageをencode/decodeした結果が元のデータと一致すること', async () => {
    const protoPath = path.join(
      path.dirname(require.resolve('castv2/package.json')),
      'lib',
      'cast_channel.proto'
    )

    const root = await protobuf.load(protoPath)
    const CastMessage = root.lookupType('extensions.api.cast_channel.CastMessage')

    const original = {
      protocolVersion: 0,
      sourceId: 'sender-0',
      destinationId: 'receiver-0',
      namespace: 'urn:x-cast:com.google.cast.tp.connection',
      payloadType: 0,
      payloadUtf8: JSON.stringify({ type: 'CONNECT' })
    }

    const encoded = CastMessage.encode(original).finish()
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(0)

    const decoded = CastMessage.decode(encoded)

    expect(decoded.sourceId).toBe(original.sourceId)
    expect(decoded.destinationId).toBe(original.destinationId)
    expect(decoded.namespace).toBe(original.namespace)
    expect(decoded.payloadType).toBe(original.payloadType)
    expect(decoded.payloadUtf8).toBe(original.payloadUtf8)
  })

  test('実際のcastv2モジュール(lib/proto.js)がCastMessageのserialize/parseに使えること', (done) => {
    // castv2/lib/proto.jsはprotobuf.load()を非同期実行してからexportsへ生やすため、
    // requireした直後は未初期化の可能性がある。実際にgoogle-home-notifier-2.jsが
    // requireするcastv2-client経由の初期化タイミングと同じ非同期性を踏まえ、
    // ポーリングでextension登録完了を待つ。
    delete require.cache[require.resolve('castv2/lib/proto.js')]
    const proto = require('castv2/lib/proto.js')

    const original = { protocolVersion: 0, sourceId: 's', destinationId: 'd', namespace: 'n', payloadType: 0, payloadUtf8: 'x' }

    const waitUntilLoaded = () => {
      try {
        const encoded = proto.CastMessage.serialize(original)
        const decoded = proto.CastMessage.parse(encoded)
        expect(decoded.sourceId).toBe(original.sourceId)
        expect(decoded.payloadUtf8).toBe(original.payloadUtf8)
        done()
      } catch (err) {
        if (err.message === 'extension not loaded yet') {
          setImmediate(waitUntilLoaded)
          return
        }
        done(err)
      }
    }

    waitUntilLoaded()
  })
})
