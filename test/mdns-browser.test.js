'use strict'

// bonjour-service への実接続(UDPマルチキャストソケットのオープン等)を避けるため mock に差し替える。

const mockBrowser = { start: jest.fn(), stop: jest.fn(), on: jest.fn() }
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

  test('Bonjourインスタンスを1つだけ生成する(module require時に1回)', () => {
    require('../mdns-browser')

    expect(mockBonjour).toHaveBeenCalledTimes(1)
  })

  test('createGoogleCastBrowser()はGoogle Castのサービスタイプ(_googlecast._tcp)でfind()した結果を返す', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    const browser = createGoogleCastBrowser()

    expect(mockFind).toHaveBeenCalledWith({ type: 'googlecast', protocol: 'tcp' })
    expect(browser).toBe(mockBrowser)
  })

  test('createGoogleCastBrowser()を複数回呼び出しても、同じBonjourインスタンスのfind()が都度呼び出される(Bonjourインスタンス自体は使い回す)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    createGoogleCastBrowser()
    createGoogleCastBrowser()

    expect(mockBonjour).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenCalledTimes(2)
  })
})
