'use strict'

// package.jsonのoverridesでcastv2配下のprotobufjsをcastv2本来の宣言(^6.8.8)から
// 7系(^7.6.5)へ引き上げている(Issue #84)。castv2自体はコード変更されていないため、
// 実際にインストールされているcastv2 / protobufjsとcastv2同梱のcast_channel.protoを使い、
// CastMessageのserialize/deserializeがoverride後も成立することを継続的に担保する。
// protobufjs自体の正しさを検証する目的ではない。

const path = require('path')
const { createRequire } = require('module')

// このファイル自身のrequire('protobufjs')はdependency treeのhoisting次第で
// castv2とは別のprotobufjs(例えば@google-cloud/text-to-speech経由の7.x)を
// 指す可能性があり、それだとoverrideがcastv2側に実際に効いているかを検証
// できない。castv2/lib/proto.jsのmodule resolution contextから解決することで、
// 「castv2が実際に使うprotobufjs」だけをテスト対象にする。
const castv2ProtoPath = require.resolve('castv2/lib/proto.js')
const castv2Require = createRequire(castv2ProtoPath)
const protobuf = castv2Require('protobufjs')
const castChannelProtoPath = path.join(path.dirname(castv2ProtoPath), 'cast_channel.proto')

describe('castv2 + protobufjs override互換性 (Issue #84)', () => {
  test('castv2が実際に解決するprotobufjsが7系であること', () => {
    const installedVersion = castv2Require('protobufjs/package.json').version
    expect(installedVersion.split('.')[0]).toBe('7')
  })

  test('castv2同梱のcast_channel.protoからCastMessageをlookupTypeできること', async () => {
    const root = await protobuf.load(castChannelProtoPath)
    const CastMessage = root.lookupType('extensions.api.cast_channel.CastMessage')

    expect(CastMessage).toBeDefined()
  })

  test('CastMessageをencode/decodeした結果が元のデータと一致すること', async () => {
    const root = await protobuf.load(castChannelProtoPath)
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
    delete require.cache[castv2ProtoPath]
    const proto = require(castv2ProtoPath)

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
