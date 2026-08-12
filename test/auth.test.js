'use strict'

const { requireBearerToken } = require('../auth')

describe('requireBearerToken()', () => {
  const expectedToken = 'correct-token'

  const createRes = () => ({
    sendStatus: jest.fn(),
    status: jest.fn(function () { return this }),
    json: jest.fn()
  })

  test('正しいBearer Tokenの場合、next()が呼ばれ401は返さない', () => {
    const req = { headers: { authorization: `Bearer ${expectedToken}` } }
    const res = createRes()
    const next = jest.fn()

    requireBearerToken(expectedToken)(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.sendStatus).not.toHaveBeenCalled()
  })

  test('Authorizationヘッダーがない場合、401を返しnext()は呼ばれない', () => {
    const req = { headers: {} }
    const res = createRes()
    const next = jest.fn()

    requireBearerToken(expectedToken)(req, res, next)

    expect(res.sendStatus).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('Bearer Tokenが不正な場合、401を返しnext()は呼ばれない', () => {
    const req = { headers: { authorization: 'Bearer wrong-token' } }
    const res = createRes()
    const next = jest.fn()

    requireBearerToken(expectedToken)(req, res, next)

    expect(res.sendStatus).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('Bearer形式ではないAuthorizationヘッダーの場合、401を返しnext()は呼ばれない', () => {
    const req = { headers: { authorization: `Basic ${expectedToken}` } }
    const res = createRes()
    const next = jest.fn()

    requireBearerToken(expectedToken)(req, res, next)

    expect(res.sendStatus).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('トークンの長さが期待値と異なる場合も401を返しnext()は呼ばれない', () => {
    const req = { headers: { authorization: 'Bearer short' } }
    const res = createRes()
    const next = jest.fn()

    requireBearerToken(expectedToken)(req, res, next)

    expect(res.sendStatus).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})
