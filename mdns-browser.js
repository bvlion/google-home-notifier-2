// Google Cast デバイスの mDNS (`_googlecast._tcp`) discovery 部分だけを切り出したアダプタ。
//
// 旧来 `mdns@2.7.2`(native addon)を使用していたが、Node.js 24ではNan/V8 API非互換により
// npm ci時のnative buildが失敗する(nan.hのSetAccessorがv8::Interceptedを返す新シグネチャに
// 対応していないため)。bonjour-service はnative addonを持たないpure JavaScript実装で、
// Node.jsバージョンに依存せず動作するため置き換えた。
//
// bonjour-serviceのBrowserは `mdns.createBrowser()` が返すオブジェクトと同様に
// start()/stop()/on(event, handler) を持ち、`up` イベントで渡されるserviceオブジェクトも
// name/addresses/port を持つため、呼び出し側(google-home-notifier-2.js)はイベント名
// (`serviceUp` → `up`)以外の変更を必要としない。
const { Bonjour } = require('bonjour-service')

const bonjour = new Bonjour()

const createGoogleCastBrowser = () => bonjour.find({ type: 'googlecast', protocol: 'tcp' })

module.exports = { createGoogleCastBrowser }
