'use strict'

// 通知用POSTエンドポイントに対する Bearer Token 認証。
// ngrok 等で外部公開された際に第三者が無認証で通知を実行できないようにするための
// シンプルな共有シークレット方式(Issue #62)。

const crypto = require('crypto')

const BEARER_PREFIX = 'Bearer '

const parseBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null
  }
  return authorizationHeader.slice(BEARER_PREFIX.length)
}

// トークンの長さの違いから情報が漏れないよう、長さが異なる場合も
// crypto.timingSafeEqual を用いた比較と同程度の処理を行ってから false を返す。
const safeCompare = (a, b) => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

// 実際のトークン値や入力値をレスポンス・ログへ出さないよう、
// 認証失敗時は常に401のみを返す。
const requireBearerToken = (expectedToken) => (req, res, next) => {
  const token = parseBearerToken(req.headers.authorization)
  if (!token || !safeCompare(token, expectedToken)) {
    return res.sendStatus(401)
  }
  return next()
}

exports.requireBearerToken = requireBearerToken
