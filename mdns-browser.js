'use strict'

// Google Cast デバイスの mDNS (`_googlecast._tcp`) discoveryアダプタ。
//
// - `Bonjour#find(opts, onUp)`はonUpをstart()より先に`on('up', onUp)`登録してから同期的に
//   探索を開始するため、onUpは必ず`find()`の第2引数として渡す(後から`browser.on('up', ...)`
//   すると、登録前に届いたserviceを取りこぼす)。
// - `Browser#stop()`はそのBrowser自身のmDNS response listenerを外すだけで、UDP multicast
//   socketは`Bonjour`インスタンス側が保持し続ける。socketを解放するには`Bonjour#destroy()`も
//   呼ぶ必要がある(呼ばないと短命scriptでNode.jsプロセスが終了できなくなる)。
// discoveryごとに専用の`Bonjour`インスタンスを生成するため、並行する複数のdiscoveryは
// 互いのcleanupで影響を受けない。
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
