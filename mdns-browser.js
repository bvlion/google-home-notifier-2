'use strict'

// Google Cast デバイスの mDNS (`_googlecast._tcp`) discovery 部分だけを切り出したアダプタ。
//
// 旧来 `mdns@2.7.2`(native addon)を使用していたが、Node.js 24ではNan/V8 API非互換により
// npm ci時のnative buildが失敗する(nan.hのSetAccessorがv8::Interceptedを返す新シグネチャに
// 対応していないため)。bonjour-service はnative addonを持たないpure JavaScript実装で、
// Node.jsバージョンに依存せず動作するため置き換えた。
//
// 旧mdnsパッケージの`createBrowser()`はbrowserを生成するだけで探索を開始せず、呼び出し側が
// 明示的に`browser.start()`してから`browser.on('serviceUp', ...)`していた。一方bonjour-service の
// `Bonjour#find(opts, onup)`は、内部で`new Browser(mdns, opts, onup)`を生成する際 onup を
// start()より先に`on('up', onup)`登録してから同期的に探索を開始する(=呼び出した瞬間に探索が
// 始まる)。そのため「find()を呼んでから後で`browser.on('up', ...)`する」実装にすると、listener
// 登録前に届いたserviceを取りこぼし、その後の`browser.start()`は既に開始済みのため何もしない
// no-opになってしまう(PR #83 Codex P1レビュー指摘)。
//
// これを避けるため、このモジュールは以下2点を満たす。
//   1. mDNS探索が実際に必要になるまで(=createGoogleCastBrowser()を呼び出すまで)Bonjour
//      インスタンス自体を生成しない。`new Bonjour()`はconstructor内でUDP multicastソケットを
//      開くため、`ip()`のみを使うprocess(private custom runner等)で不要なnetwork resourceを
//      起動しないようにするため。
//   2. `up`イベントのhandlerは`find(opts, onUp)`の第2引数として渡し、bonjour-service自身に
//      探索開始前の登録を保証させる(呼び出し側で`browser.on('up', ...)`を後から呼ばない)。
const { Bonjour } = require('bonjour-service')

let bonjour

const getBonjour = () => {
  if (!bonjour) {
    bonjour = new Bonjour()
  }
  return bonjour
}

const createGoogleCastBrowser = (onUp) => getBonjour().find({ type: 'googlecast', protocol: 'tcp' }, onUp)

module.exports = { createGoogleCastBrowser }
