'use strict'

// Google Cast デバイスの mDNS (`_googlecast._tcp`) discovery 部分だけを切り出したアダプタ。
//
// 旧来 `mdns@2.7.2`(native addon)を使用していたが、Node.js 24ではNan/V8 API非互換により
// npm ci時のnative buildが失敗する(nan.hのSetAccessorがv8::Interceptedを返す新シグネチャに
// 対応していないため)。bonjour-service はnative addonを持たないpure JavaScript実装で、
// Node.jsバージョンに依存せず動作するため置き換えた。
//
// --- lifecycle上の注意点(旧mdnsパッケージとの差分) ---
//
// 1. 探索の開始タイミング(PR #83 Codex P1レビュー対応)
//    旧mdnsパッケージの`createBrowser()`はbrowserを生成するだけで探索を開始せず、呼び出し側が
//    明示的に`browser.start()`してから`browser.on('serviceUp', ...)`していた。一方bonjour-service
//    の`Bonjour#find(opts, onup)`は、内部で`new Browser(mdns, opts, onup)`を生成する際 onup を
//    start()より先に`on('up', onup)`登録してから同期的に探索を開始する(=呼び出した瞬間に探索が
//    始まる)。そのため「find()を呼んでから後で`browser.on('up', ...)`する」実装にすると、listener
//    登録前に届いたserviceを取りこぼしてしまう。これを避けるため、`up`イベントのhandlerは
//    `find(opts, onUp)`の第2引数として渡し、bonjour-service自身に探索開始前の登録を保証させる。
//
// 2. socket resourceの解放(PR #83 Codex P2レビュー対応)
//    bonjour-serviceでは`Browser#stop()`はそのBrowser自身のmDNS response listenerを外すだけで、
//    実際にUDP multicastソケットを保持しているのは`Bonjour`インスタンス(内部の`Server`/
//    `multicast-dns`)側であり、`Bonjour#destroy()`を呼ばない限りソケットは開いたままになる。
//    device()経路で1回だけ探索して終了する短命scriptの場合、`browser.stop()`だけではソケットが
//    残り続け、通知callback完了後もNode.jsプロセスが終了できなくなる可能性があった。
//    これを避けるため、discoveryごとに専用の`Bonjour`インスタンスを生成し、対象deviceが見つかって
//    呼び出し側が返り値の`stop()`を呼んだタイミングでBrowser側の停止とあわせて、そのdiscovery
//    専用のBonjour自体も`destroy()`する。discoveryごとに独立したBonjour/socketを持つため、
//    並行して走る複数のdiscoveryが互いのcleanupで壊されることもない(共有singletonにして
//    参照カウントでdestroyタイミングを管理するより、単純かつ安全なため)。
const { Bonjour } = require('bonjour-service')

const createGoogleCastBrowser = (onUp) => {
  const bonjour = new Bonjour()
  const browser = bonjour.find({ type: 'googlecast', protocol: 'tcp' }, onUp)

  let stopped = false
  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    browser.stop()
    bonjour.destroy()
  }

  return { stop }
}

module.exports = { createGoogleCastBrowser }
