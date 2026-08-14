'use strict'

// bonjour-service への実接続(UDPマルチキャストソケットのオープン等)を避けるため mock に差し替える。
// createGoogleCastBrowser()はdiscoveryごとに専用のBonjourインスタンスを生成する設計(PR #83
// Codex P2レビュー対応)のため、テストでも呼び出しごとに独立したmock Bonjour/Browserを積み上げる。

const mockInstances = []

const mockBonjour = jest.fn(() => {
  const browser = { stop: jest.fn() }
  const find = jest.fn(() => browser)
  const destroy = jest.fn()
  mockInstances.push({ find, destroy, browser })
  return { find, destroy }
})

jest.mock('bonjour-service', () => ({
  Bonjour: mockBonjour
}))

describe('mdns-browser', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockInstances.length = 0
  })

  test('moduleをrequireしただけではBonjourインスタンスを生成しない(mDNS探索用のUDPソケットを開かない)', () => {
    require('../mdns-browser')

    expect(mockBonjour).not.toHaveBeenCalled()
  })

  test('createGoogleCastBrowser()を呼び出した時点で初めてBonjourインスタンスを生成する(lazy生成)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    createGoogleCastBrowser(jest.fn())

    expect(mockBonjour).toHaveBeenCalledTimes(1)
  })

  test('createGoogleCastBrowser()を呼び出すたびに、そのdiscovery専用の新しいBonjourインスタンスを生成する(共有singletonにはしない。PR #83 Codex P2レビュー対応)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    createGoogleCastBrowser(jest.fn())
    createGoogleCastBrowser(jest.fn())

    expect(mockBonjour).toHaveBeenCalledTimes(2)
  })

  test('createGoogleCastBrowser(onUp)は、Google Castのサービスタイプ(_googlecast._tcp)と渡されたonUpでfind()した結果を返す(onUpは探索開始前に登録される必要があるため、find()の第2引数として渡す)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')
    const onUp = jest.fn()

    createGoogleCastBrowser(onUp)

    expect(mockInstances[0].find).toHaveBeenCalledWith({ type: 'googlecast', protocol: 'tcp' }, onUp)
  })

  test('返り値のstop()を呼ぶと、そのdiscoveryのBrowser停止(browser.stop())とBonjourの破棄(bonjour.destroy())の両方が行われる(browser.stop()だけではmulticast-dns socketが残り続け、短命scriptでNode.jsプロセスが終了できなくなるため。PR #83 Codex P2レビュー対応)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    const result = createGoogleCastBrowser(jest.fn())
    result.stop()

    expect(mockInstances[0].browser.stop).toHaveBeenCalledTimes(1)
    expect(mockInstances[0].destroy).toHaveBeenCalledTimes(1)
  })

  test('stop()を複数回呼び出しても、Bonjourのdestroy()は1回だけ実行される(冪等性)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    const result = createGoogleCastBrowser(jest.fn())
    result.stop()
    result.stop()

    expect(mockInstances[0].browser.stop).toHaveBeenCalledTimes(1)
    expect(mockInstances[0].destroy).toHaveBeenCalledTimes(1)
  })

  test('並行して2つのdiscoveryが走っている場合、一方のstop()(Browser停止+Bonjour破棄)がもう一方のdiscoveryのBrowser/Bonjourへ影響しない(discoveryごとに専用のBonjour/socketを持つため)', () => {
    const { createGoogleCastBrowser } = require('../mdns-browser')

    const first = createGoogleCastBrowser(jest.fn())
    createGoogleCastBrowser(jest.fn())

    first.stop()

    expect(mockInstances[0].browser.stop).toHaveBeenCalledTimes(1)
    expect(mockInstances[0].destroy).toHaveBeenCalledTimes(1)
    expect(mockInstances[1].browser.stop).not.toHaveBeenCalled()
    expect(mockInstances[1].destroy).not.toHaveBeenCalled()
  })

  test('find()呼び出し中(理論上最速のタイミング)に同期的にonUpが発火しても、正しくonUpへ通知される(listener登録が探索開始より先であることの保証。PR #83 Codex P1レビュー対応の回帰)', () => {
    mockBonjour.mockImplementationOnce(() => {
      const browser = { stop: jest.fn() }
      const find = jest.fn((opts, handler) => {
        handler({ name: 'Living-Room-ABCD', addresses: ['192.168.1.77'], port: 8009 })
        return browser
      })
      const destroy = jest.fn()
      mockInstances.push({ find, destroy, browser })
      return { find, destroy }
    })

    const { createGoogleCastBrowser } = require('../mdns-browser')
    const onUp = jest.fn()

    createGoogleCastBrowser(onUp)

    expect(onUp).toHaveBeenCalledWith({ name: 'Living-Room-ABCD', addresses: ['192.168.1.77'], port: 8009 })
  })
})
