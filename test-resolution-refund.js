#!/usr/bin/env node
/**
 * Resolution refund regression test.
 *
 * Reproduces a winner-settlement flow and verifies creator refund is computed as:
 *   max(0, initialLiquidity + netTradeCostBeforeSettlement - totalPayout)
 * and is not inflated by settlement trade entries.
 */

const BASE_URL = 'http://localhost:3001'

class CookieJar {
  constructor() {
    this.cookies = {}
  }

  setCookies(setCookieHeader) {
    if (Array.isArray(setCookieHeader)) {
      setCookieHeader.forEach((h) => this.parseCookie(h))
    } else if (setCookieHeader) {
      this.parseCookie(setCookieHeader)
    }
  }

  parseCookie(cookieStr) {
    const [nameValue] = cookieStr.split(';')
    const [name, value] = nameValue.split('=')
    if (name && value) this.cookies[name.trim()] = value
  }

  getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
}

async function request(method, path, body = null, jar = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (jar) {
    const cookieHeader = jar.getCookieHeader()
    if (cookieHeader) headers.Cookie = cookieHeader
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const setCookieHeaders = res.headers.getSetCookie?.() || []
  if (jar && setCookieHeaders.length > 0) {
    jar.setCookies(setCookieHeaders)
  }

  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  return { status: res.status, ok: res.ok, data }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function approxEqual(actual, expected, tolerance = 0.0001) {
  return Math.abs(actual - expected) <= tolerance
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Server did not start within 20 seconds')
}

async function registerUniqueUser(prefix) {
  const jar = new CookieJar()
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    email: `${prefix}-${suffix}@example.com`,
    username: `${prefix}_${suffix}`,
    password: 'password123',
  }

  const res = await request('POST', '/api/auth/register', payload, jar)
  assert(res.ok, `Register failed for ${prefix}: ${JSON.stringify(res.data)}`)
  return { jar, user: res.data.user }
}

async function run() {
  console.log('Running resolution refund regression test...')
  await waitForServer()

  const creator = await registerUniqueUser('creator')
  const trader = await registerUniqueUser('trader')

  const creatorMeBefore = await request('GET', '/api/auth/me', null, creator.jar)
  assert(creatorMeBefore.ok, `Failed to fetch creator /me: ${JSON.stringify(creatorMeBefore.data)}`)
  const creatorBalanceBeforeCreate = creatorMeBefore.data.balance

  const initialLiquidity = 100
  const buyShares = 200

  const createRes = await request(
    'POST',
    '/api/markets',
    {
      title: `Resolution refund regression ${Date.now()}`,
      description: 'Checks creator refund accounting during winner settlement.',
      category: 'Test',
      endDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      resolutionSource: 'https://example.com',
      initialLiquidity,
      priorProbability: 0.5,
      tags: ['regression', 'resolution'],
    },
    creator.jar
  )
  assert(createRes.ok, `Create market failed: ${JSON.stringify(createRes.data)}`)
  const marketId = createRes.data.market.id

  const creatorMeAfterCreate = await request('GET', '/api/auth/me', null, creator.jar)
  assert(creatorMeAfterCreate.ok, `Failed to fetch creator /me after create: ${JSON.stringify(creatorMeAfterCreate.data)}`)
  const creatorBalanceAfterCreate = creatorMeAfterCreate.data.balance
  assert(
    approxEqual(creatorBalanceAfterCreate, creatorBalanceBeforeCreate - initialLiquidity),
    `Creator create-liquidity debit mismatch. Before=${creatorBalanceBeforeCreate} After=${creatorBalanceAfterCreate}`
  )

  const buyRes = await request(
    'POST',
    `/api/markets/${marketId}/trade`,
    { outcome: 'YES', type: 'BUY', shares: buyShares },
    trader.jar
  )
  assert(buyRes.ok, `Trader buy failed: ${JSON.stringify(buyRes.data)}`)

  const netTradeCostBeforeSettlement = buyRes.data.trade.totalCost
  const expectedTotalPayout = buyShares
  const expectedCreatorRefund = Math.max(
    0,
    initialLiquidity + netTradeCostBeforeSettlement - expectedTotalPayout
  )

  const resolveRes = await request(
    'POST',
    `/api/markets/${marketId}/resolve`,
    { outcome: 'YES' },
    creator.jar
  )
  assert(resolveRes.ok, `Resolve failed: ${JSON.stringify(resolveRes.data)}`)

  const settlement = resolveRes.data.settlement
  assert(settlement, `Missing settlement payload: ${JSON.stringify(resolveRes.data)}`)

  assert(
    approxEqual(settlement.totalPayout, expectedTotalPayout),
    `Total payout mismatch. Expected ${expectedTotalPayout}, got ${settlement.totalPayout}`
  )

  assert(
    approxEqual(settlement.netTradeCost, netTradeCostBeforeSettlement),
    `netTradeCost mismatch. Expected ${netTradeCostBeforeSettlement}, got ${settlement.netTradeCost}`
  )

  assert(
    approxEqual(settlement.refundedToCreator, expectedCreatorRefund),
    `Creator refund mismatch. Expected ${expectedCreatorRefund}, got ${settlement.refundedToCreator}`
  )

  // Old buggy logic would effectively produce initialLiquidity + netTradeCostBeforeSettlement.
  const oldBuggyRefund = initialLiquidity + netTradeCostBeforeSettlement
  assert(
    !approxEqual(settlement.refundedToCreator, oldBuggyRefund, 0.01),
    `Regression detected: refund (${settlement.refundedToCreator}) matches old buggy value (${oldBuggyRefund})`
  )

  const creatorMeAfterResolve = await request('GET', '/api/auth/me', null, creator.jar)
  assert(creatorMeAfterResolve.ok, `Failed to fetch creator /me after resolve: ${JSON.stringify(creatorMeAfterResolve.data)}`)
  const creatorBalanceAfterResolve = creatorMeAfterResolve.data.balance
  const expectedCreatorBalanceAfterResolve = creatorBalanceAfterCreate + expectedCreatorRefund

  assert(
    approxEqual(creatorBalanceAfterResolve, expectedCreatorBalanceAfterResolve),
    `Creator balance after resolve mismatch. Expected ${expectedCreatorBalanceAfterResolve}, got ${creatorBalanceAfterResolve}`
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        marketId,
        initialLiquidity,
        buyShares,
        netTradeCostBeforeSettlement,
        expectedTotalPayout,
        expectedCreatorRefund,
        actualCreatorRefund: settlement.refundedToCreator,
        oldBuggyRefund,
      },
      null,
      2
    )
  )
}

run().catch((err) => {
  console.error('Resolution refund regression test failed:', err.message)
  process.exit(1)
})
