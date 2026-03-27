#!/usr/bin/env node
/**
 * Re-resolution refund regression test.
 *
 * Verifies that when a dispute changes the market resolution, the previous
 * creator liquidity refund is reversed and replaced with the refund implied by
 * the new outcome.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'

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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`)
      if (res.ok) return
    } catch {
      // retry
    }
    await sleep(500)
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

async function getBalance(jar, label) {
  const res = await request('GET', '/api/auth/me', null, jar)
  assert(res.ok, `Failed to fetch ${label} /me: ${JSON.stringify(res.data)}`)
  return res.data.balance
}

async function run() {
  console.log('Running re-resolution refund regression test...')
  await waitForServer()

  const creator = await registerUniqueUser('creator')
  const trader = await registerUniqueUser('trader')
  const voterOne = await registerUniqueUser('voterone')
  const voterTwo = await registerUniqueUser('votertwo')

  const creatorBalanceBeforeCreate = await getBalance(creator.jar, 'creator')

  const initialLiquidity = 100
  const buyShares = 200
  const marketEndsAt = new Date(Date.now() + 2_000)

  const createRes = await request(
    'POST',
    '/api/markets',
    {
      title: `Re-resolution refund regression ${Date.now()}`,
      description: 'Checks creator refund accounting when a dispute changes the outcome.',
      category: 'Test',
      endDate: marketEndsAt.toISOString(),
      resolutionSource: 'https://example.com',
      initialLiquidity,
      priorProbability: 0.5,
      tags: ['regression', 'dispute', 'resolution'],
    },
    creator.jar
  )
  assert(createRes.ok, `Create market failed: ${JSON.stringify(createRes.data)}`)
  const marketId = createRes.data.market.id

  const creatorBalanceAfterCreate = await getBalance(creator.jar, 'creator after create')
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
  const firstExpectedRefund = Math.max(0, initialLiquidity + netTradeCostBeforeSettlement - buyShares)
  const secondExpectedRefund = Math.max(0, initialLiquidity + netTradeCostBeforeSettlement)

  const initialResolveRes = await request(
    'POST',
    `/api/markets/${marketId}/resolve`,
    { outcome: 'YES' },
    creator.jar
  )
  assert(initialResolveRes.ok, `Initial resolve failed: ${JSON.stringify(initialResolveRes.data)}`)

  const initialSettlement = initialResolveRes.data.settlement
  assert(initialSettlement, `Missing initial settlement payload: ${JSON.stringify(initialResolveRes.data)}`)
  assert(
    approxEqual(initialSettlement.refundedToCreator, firstExpectedRefund),
    `Initial creator refund mismatch. Expected ${firstExpectedRefund}, got ${initialSettlement.refundedToCreator}`
  )

  const creatorBalanceAfterInitialResolve = await getBalance(creator.jar, 'creator after initial resolve')
  assert(
    approxEqual(creatorBalanceAfterInitialResolve, creatorBalanceAfterCreate + firstExpectedRefund),
    `Creator balance after initial resolve mismatch. Expected ${creatorBalanceAfterCreate + firstExpectedRefund}, got ${creatorBalanceAfterInitialResolve}`
  )

  const disputeRes = await request(
    'POST',
    `/api/markets/${marketId}/dispute`,
    {
      proposedOutcome: 'NO',
      reason: 'The original resolution was incorrect and the opposite outcome should settle the market.',
    },
    voterOne.jar
  )
  assert(disputeRes.ok, `Dispute failed: ${JSON.stringify(disputeRes.data)}`)

  const msUntilMarketEnd = marketEndsAt.getTime() - Date.now()
  if (msUntilMarketEnd > 0) {
    await sleep(msUntilMarketEnd + 250)
  }

  const firstVoteRes = await request(
    'POST',
    `/api/markets/${marketId}/vote`,
    { outcome: 'NO' },
    voterOne.jar
  )
  assert(firstVoteRes.ok, `First dispute vote failed: ${JSON.stringify(firstVoteRes.data)}`)
  assert(firstVoteRes.data.autoResolved === false, 'Market should not re-resolve on the first dispute vote')

  const secondVoteRes = await request(
    'POST',
    `/api/markets/${marketId}/vote`,
    { outcome: 'NO' },
    voterTwo.jar
  )
  assert(secondVoteRes.ok, `Second dispute vote failed: ${JSON.stringify(secondVoteRes.data)}`)
  assert(secondVoteRes.data.autoResolved === true, 'Market should re-resolve on the second dispute vote')
  assert(secondVoteRes.data.majorityOutcome === 'NO', `Expected majority outcome NO, got ${secondVoteRes.data.majorityOutcome}`)

  const creatorBalanceAfterReResolution = await getBalance(creator.jar, 'creator after re-resolution')
  const expectedBalanceAfterReResolution = creatorBalanceAfterCreate + secondExpectedRefund
  assert(
    approxEqual(creatorBalanceAfterReResolution, expectedBalanceAfterReResolution),
    `Creator balance after re-resolution mismatch. Expected ${expectedBalanceAfterReResolution}, got ${creatorBalanceAfterReResolution}`
  )

  const incorrectStackedBalance = creatorBalanceAfterCreate + firstExpectedRefund + secondExpectedRefund
  assert(
    !approxEqual(creatorBalanceAfterReResolution, incorrectStackedBalance, 0.01),
    `Regression detected: creator kept both refunds (${creatorBalanceAfterReResolution}) instead of only the latest one (${expectedBalanceAfterReResolution})`
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        marketId,
        netTradeCostBeforeSettlement,
        firstExpectedRefund,
        secondExpectedRefund,
        creatorBalanceAfterInitialResolve,
        creatorBalanceAfterReResolution,
      },
      null,
      2
    )
  )
}

run().catch((err) => {
  console.error('Re-resolution refund regression test failed:', err.message)
  process.exit(1)
})