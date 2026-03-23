#!/usr/bin/env node
/**
 * Exchange integration test
 * Validates:
 * 1) BID-maker partial fill + cancellation + refund
 * 2) ASK-maker with BID taker reserve release
 *
 * Usage:
 *   node test-exchange-orders.js                # runs both scenarios
 *   node test-exchange-orders.js bid-maker      # runs scenario 1 only
 *   node test-exchange-orders.js ask-maker      # runs scenario 2 only
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

function approxEqual(actual, expected, tolerance = 0.000001) {
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

async function registerUniqueUser(suffix) {
  const jar = new CookieJar()
  const payload = {
    email: `exchange-test-${suffix}@example.com`,
    username: `exchange_test_${suffix}`,
    password: 'password123',
  }

  const res = await request('POST', '/api/auth/register', payload, jar)
  assert(res.ok, `Register failed: ${JSON.stringify(res.data)}`)
  return { jar, user: res.data.user }
}

async function getBalance(jar) {
  const res = await request('GET', '/api/auth/me', null, jar)
  assert(res.ok, `Failed to fetch /api/auth/me: ${JSON.stringify(res.data)}`)
  return res.data.balance
}

async function run() {
  const scenarioArg = process.argv[2]
  const runBidMakerScenario = !scenarioArg || scenarioArg === 'bid-maker'
  const runAskMakerScenario = !scenarioArg || scenarioArg === 'ask-maker'

  if (!runBidMakerScenario && !runAskMakerScenario) {
    throw new Error('Unknown scenario argument. Use: bid-maker | ask-maker')
  }

  console.log('Running exchange integration test...')
  await waitForServer()

  const suffixA = `${Date.now()}a`
  const suffixB = `${Date.now()}b`

  const traderA = await registerUniqueUser(suffixA)
  const traderB = await registerUniqueUser(suffixB)

  const marketRes = await request(
    'POST',
    '/api/markets',
    {
      title: `Exchange test market ${Date.now()}`,
      description: 'Integration test market for exchange partial fill and cancellation refund checks.',
      category: 'Crypto',
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      resolutionSource: 'https://example.com',
      tags: ['exchange', 'integration'],
    },
    traderA.jar
  )
  assert(marketRes.ok, `Create market failed: ${JSON.stringify(marketRes.data)}`)
  const marketId = marketRes.data.market.id

  if (runBidMakerScenario) {
    console.log('Scenario 1: BID maker -> partial fill -> cancel remainder')

    const buyRes = await request(
      'POST',
      `/api/markets/${marketId}/trade`,
      { outcome: 'YES', type: 'BUY', shares: 5 },
      traderA.jar
    )
    assert(buyRes.ok, `AMM buy failed: ${JSON.stringify(buyRes.data)}`)

    const balanceBBeforeBid = await getBalance(traderB.jar)

    const bidPrice = 0.7
    const bidShares = 2
    const bidReserve = bidPrice * bidShares

    const bidRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'YES', side: 'BID', price: bidPrice, shares: bidShares },
      traderB.jar
    )
    assert(bidRes.ok, `Place bid failed: ${JSON.stringify(bidRes.data)}`)
    assert(approxEqual(bidRes.data.filledShares, 0), 'Expected initial bid to have zero fills')

    const balanceBAfterBid = await getBalance(traderB.jar)
    assert(
      approxEqual(balanceBAfterBid, balanceBBeforeBid - bidReserve),
      `Bid reserve mismatch. Before=${balanceBBeforeBid} After=${balanceBAfterBid} Reserve=${bidReserve}`
    )

    const askRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'YES', side: 'ASK', price: 0.6, shares: 1 },
      traderA.jar
    )
    assert(askRes.ok, `Place ask failed: ${JSON.stringify(askRes.data)}`)
    assert(approxEqual(askRes.data.filledShares, 1), `Expected ask to fill 1 share, got ${askRes.data.filledShares}`)

    const marketForB = await request('GET', `/api/markets/${marketId}`, null, traderB.jar)
    assert(marketForB.ok, `Fetch market failed: ${JSON.stringify(marketForB.data)}`)

    const openBid = (marketForB.data.orders || []).find(
      (o) => o.userId === traderB.user.id && o.side === 'BID' && o.outcome === 'YES' && o.remainingShares > 0
    )
    assert(openBid, 'Expected a remaining open bid after partial fill')
    assert(approxEqual(openBid.remainingShares, 1), `Expected remaining bid shares = 1, got ${openBid.remainingShares}`)

    const filledHistory = (marketForB.data.userOrders || []).find((o) => o.id === bidRes.data.order.id)
    assert(filledHistory, 'Expected bid order to appear in user order history')
    assert(filledHistory.status === 'PARTIAL', `Expected PARTIAL status after one fill, got ${filledHistory.status}`)

    const cancelRes = await request(
      'DELETE',
      `/api/markets/${marketId}/order`,
      { orderId: openBid.id },
      traderB.jar
    )
    assert(cancelRes.ok, `Cancel order failed: ${JSON.stringify(cancelRes.data)}`)

    const balanceBAfterCancel = await getBalance(traderB.jar)
    const expectedFinalBalanceB = balanceBBeforeBid - bidPrice
    assert(
      approxEqual(balanceBAfterCancel, expectedFinalBalanceB),
      `Bid refund mismatch. Expected ${expectedFinalBalanceB}, got ${balanceBAfterCancel}`
    )

    const marketAfterCancel = await request('GET', `/api/markets/${marketId}`, null, traderB.jar)
    assert(marketAfterCancel.ok, `Fetch market after cancel failed: ${JSON.stringify(marketAfterCancel.data)}`)

    const remainingOpenOrdersForB = (marketAfterCancel.data.orders || []).filter((o) => o.userId === traderB.user.id)
    assert(remainingOpenOrdersForB.length === 0, 'Expected no open orders for bidder after cancellation')

    const cancelledHistory = (marketAfterCancel.data.userOrders || []).find((o) => o.id === openBid.id)
    assert(cancelledHistory, 'Expected cancelled bid in user order history')
    assert(cancelledHistory.status === 'CANCELLED', `Expected CANCELLED status, got ${cancelledHistory.status}`)

    console.log(
      JSON.stringify(
        {
          scenario: 'bid-maker',
          marketId,
          balanceBBeforeBid,
          balanceBAfterBid,
          balanceBAfterCancel,
          expectedFinalBalanceB,
        },
        null,
        2
      )
    )
  }

  if (runAskMakerScenario) {
    console.log('Scenario 2: ASK maker -> BID taker -> reserve release')

    const buyNoRes = await request(
      'POST',
      `/api/markets/${marketId}/trade`,
      { outcome: 'NO', type: 'BUY', shares: 3 },
      traderA.jar
    )
    assert(buyNoRes.ok, `AMM NO buy failed: ${JSON.stringify(buyNoRes.data)}`)

    const askMakerPrice = 0.55
    const askMakerShares = 2
    const askMakerRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'NO', side: 'ASK', price: askMakerPrice, shares: askMakerShares },
      traderA.jar
    )
    assert(askMakerRes.ok, `Place maker ask failed: ${JSON.stringify(askMakerRes.data)}`)
    assert(approxEqual(askMakerRes.data.filledShares, 0), 'Expected maker ask to start with zero fills')

    const balanceBBeforeTakerBid = await getBalance(traderB.jar)
    const bidTakerPrice = 0.6
    const bidTakerShares = 1
    const bidTakerReserve = bidTakerPrice * bidTakerShares

    const bidTakerRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'NO', side: 'BID', price: bidTakerPrice, shares: bidTakerShares },
      traderB.jar
    )
    assert(bidTakerRes.ok, `Place taker bid failed: ${JSON.stringify(bidTakerRes.data)}`)
    assert(approxEqual(bidTakerRes.data.filledShares, 1), `Expected taker bid to fill 1 share, got ${bidTakerRes.data.filledShares}`)
    assert(approxEqual(bidTakerRes.data.remainingShares, 0), 'Expected taker bid to be fully filled')

    const balanceBAfterTakerBid = await getBalance(traderB.jar)
    const expectedAfterTakerBid = balanceBBeforeTakerBid - askMakerPrice
    assert(
      approxEqual(balanceBAfterTakerBid, expectedAfterTakerBid),
      `Taker bid balance mismatch. Reserve=${bidTakerReserve} expected final ${expectedAfterTakerBid}, got ${balanceBAfterTakerBid}`
    )

    const marketAfterScenario2 = await request('GET', `/api/markets/${marketId}`, null, traderA.jar)
    assert(marketAfterScenario2.ok, `Fetch market after scenario 2 failed: ${JSON.stringify(marketAfterScenario2.data)}`)

    const openAskAfterMatch = (marketAfterScenario2.data.orders || []).find(
      (o) => o.userId === traderA.user.id && o.side === 'ASK' && o.outcome === 'NO' && o.remainingShares > 0
    )
    assert(openAskAfterMatch, 'Expected remaining open ask after 1-share taker fill')
    assert(
      approxEqual(openAskAfterMatch.remainingShares, askMakerShares - 1),
      `Expected remaining ask shares = ${askMakerShares - 1}, got ${openAskAfterMatch.remainingShares}`
    )

    const askHistory = (marketAfterScenario2.data.userOrders || []).find((o) => o.id === askMakerRes.data.order.id)
    assert(askHistory, 'Expected maker ask in user order history')
    assert(askHistory.status === 'PARTIAL', `Expected maker ask PARTIAL, got ${askHistory.status}`)

    console.log(
      JSON.stringify(
        {
          scenario: 'ask-maker',
          marketId,
          balanceBBeforeTakerBid,
          balanceBAfterTakerBid,
          expectedAfterTakerBid,
        },
        null,
        2
      )
    )
  }

  console.log('PASS exchange integration test')
}

run().catch((err) => {
  console.error(`FAIL exchange integration test: ${err.message}`)
  process.exit(1)
})
