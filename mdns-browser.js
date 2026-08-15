'use strict'

const { Bonjour } = require('bonjour-service')

const createGoogleCastBrowser = (onUp) => {
  const bonjour = new Bonjour()
  // find()は探索を即開始するため、handlerは第2引数で先に登録する。
  const browser = bonjour.find({ type: 'googlecast', protocol: 'tcp' }, onUp)

  let stopped = false
  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    browser.stop()
    // Browser#stop()だけではmulticast socketが残るためdestroy()も呼ぶ。
    bonjour.destroy()
  }

  return { stop }
}

module.exports = { createGoogleCastBrowser }
