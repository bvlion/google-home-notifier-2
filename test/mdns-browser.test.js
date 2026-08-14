'use strict'

// bonjour-service への実接続(UDPマルチキャストソケットのオープン等)を避けるため mock に差し替える。

const mockBrowser = { stop: jest.fn() }
const mockFind = jest.fn(() => mockBrowser)
const mockBonjour = jest.fn(() => ({ find: mockFind }))

jest.mock('bonjour-service', () => ({
  Bonjour: mockBonjour
}))

describe('mdns-browser', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  test('moduleをrequireしただけではBonjourインスタンスを生成しない(mDNS探索用のUDPソケットを開かない)', () => {
    require('../mdns-browser')

    expect(mockBonjour).not.toHaveBeenCalled()
  })

  test('createGoogleCastBrowser()を初めて呼び出した時点で、はじめてBonjourインスタンスを生成する(lazy生成)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    createGoogleCastBrowser(jest.fn())

    expect(mockBonjour).toHaveBeenCalledTimes(1)
  })

  test('createGoogleCastBrowser(onUp)は、Google Castのサービスタイプ(_googlecast._tcp)と渡されたonUpでfind()した結果を返す(onUpは探索開始前に登録される必要があるため、find()の第2引数として渡す)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')
    const onUp = jest.fn()

    const browser = createGoogleCastBrowser(onUp)

    expect(mockFind).toHaveBeenCalledWith({ type: 'googlecast', protocol: 'tcp' }, onUp)
    expect(browser).toBe(mockBrowser)
  })

  test('createGoogleCastBrowser()を複数回呼び出しても、Bonjourインスタンス自体は使い回し、find()は都度(探索が必要になるたび)呼び出される', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    createGoogleCastBrowser(jest.fn())
    createGoogleCastBrowser(jest.fn())

    expect(mockBonjour).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenCalledTimes(2)
  })
})
