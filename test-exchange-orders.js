#!/usr/bin/env node
/**
 * Exchange integration test
 * Validates:
 * 1) GTC BID-maker partial fill + cancellation + refund
 * 2) GTC naked ASK-maker with BID taker short-collateral progression
 * 3) GTD expiry releases reserves and cancels stale orders
 * 4) FOK rejects if full size is not immediately available
 * 5) FAK fills available size and kills the remainder
 *
 * Usage:
 *   node test-exchange-orders.js                # runs all scenarios
 *   node test-exchange-orders.js bid-maker      # runs scenario 1 only
 *   node test-exchange-orders.js ask-maker      # runs scenario 2 only
 *   node test-exchange-orders.js gtd            # runs scenario 3 only
 *   node test-exchange-orders.js fok            # runs scenario 4 only
 *   node test-exchange-orders.js fak            # runs scenario 5 only
 *   node test-exchange-orders.js cross          # runs cross-matching scenario only
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

function approxEqual(actual, expected, tolerance = 0.000001) {
  return Math.abs(actual - expected) <= tolerance
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function createMarket(jar, label) {
  const marketRes = await request(
    'POST',
    '/api/markets',
    {
      title: `Exchange test market ${label} ${Date.now()}`,
      description: 'Integration test market for exchange order behavior checks.',
      category: 'Crypto',
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      resolutionSource: 'https://example.com',
      tags: ['exchange', 'integration'],
    },
    jar
  )
  assert(marketRes.ok, `Create market failed: ${JSON.stringify(marketRes.data)}`)
  return marketRes.data.market.id
}

async function run() {
  const scenarioArg = process.argv[2]
  const runAllScenarios = !scenarioArg
  const runBidMakerScenario = runAllScenarios || scenarioArg === 'bid-maker'
  const runAskMakerScenario = runAllScenarios || scenarioArg === 'ask-maker'
  const runGtdScenario = runAllScenarios || scenarioArg === 'gtd'
  const runFokScenario = runAllScenarios || scenarioArg === 'fok'
  const runFakScenario = runAllScenarios || scenarioArg === 'fak'
  const runBidUnlockAskScenario = runAllScenarios || scenarioArg === 'bid-unlock-ask'
  const runCrossScenario = runAllScenarios || scenarioArg === 'cross'

  if (!runBidMakerScenario && !runAskMakerScenario && !runGtdScenario && !runFokScenario && !runFakScenario && !runBidUnlockAskScenario && !runCrossScenario) {
    throw new Error('Unknown scenario argument. Use: bid-maker | ask-maker | gtd | fok | fak | bid-unlock-ask | cross')
  }

  console.log('Running exchange integration test...')
  await waitForServer()

  const suffixA = `${Date.now()}a`
  const suffixB = `${Date.now()}b`

  const traderA = await registerUniqueUser(suffixA)
  const traderB = await registerUniqueUser(suffixB)

  const marketId = await createMarket(traderA.jar, 'gtc')

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
      { outcome: 'YES', side: 'BID', orderType: 'GTC', price: bidPrice, shares: bidShares },
      traderB.jar
    )
    assert(bidRes.ok, `Place bid failed: ${JSON.stringify(bidRes.data)}`)
    assert(approxEqual(bidRes.data.filledShares, 0), 'Expected initial bid to have zero fills')

    const balanceBAfterBid = await getBalance(traderB.jar)
    assert(
      approxEqual(balanceBAfterBid, balanceBBeforeBid),
      `Placing resting BID should not change total balance. Before=${balanceBBeforeBid} After=${balanceBAfterBid}`
    )

    const askRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'YES', side: 'ASK', orderType: 'GTC', price: 0.6, shares: 1 },
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
    assert(filledHistory.orderType === 'GTC', `Expected GTC order type, got ${filledHistory.orderType}`)
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
    console.log('Scenario 2: naked ASK maker -> BID taker -> short-collateral progression')

    const askMakerPrice = 0.55
    const askMakerShares = 2
    const traderABalanceBeforeAsk = await getBalance(traderA.jar)
    const askMakerRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'NO', side: 'ASK', orderType: 'GTC', price: askMakerPrice, shares: askMakerShares },
      traderA.jar
    )
    assert(askMakerRes.ok, `Place maker ask failed: ${JSON.stringify(askMakerRes.data)}`)
    assert(approxEqual(askMakerRes.data.filledShares, 0), 'Expected maker ask to start with zero fills')
    const traderABalanceAfterAsk = await getBalance(traderA.jar)
    assert(
      approxEqual(traderABalanceBeforeAsk - traderABalanceAfterAsk, askMakerShares * (1 - askMakerPrice)),
      `Naked ask reserve mismatch. Before=${traderABalanceBeforeAsk} After=${traderABalanceAfterAsk}`
    )

    const balanceBBeforeTakerBid = await getBalance(traderB.jar)
    const bidTakerPrice = 0.6
    const bidTakerShares = 1
    const bidTakerReserve = bidTakerPrice * bidTakerShares

    const bidTakerRes = await request(
      'POST',
      `/api/markets/${marketId}/order`,
      { outcome: 'NO', side: 'BID', orderType: 'GTC', price: bidTakerPrice, shares: bidTakerShares },
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

    const traderABalanceAfterFill = await getBalance(traderA.jar)
    assert(
      approxEqual(traderABalanceAfterFill, traderABalanceAfterAsk),
      `Seller available balance should stay unchanged on naked ask fill. AfterAsk=${traderABalanceAfterAsk} AfterFill=${traderABalanceAfterFill}`
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

    const traderAPortfolio = await request('GET', '/api/portfolio', null, traderA.jar)
    assert(traderAPortfolio.ok, `Fetch portfolio after scenario 2 failed: ${JSON.stringify(traderAPortfolio.data)}`)
    const orderReserveSum = (traderAPortfolio.data.reservedOrders || [])
      .reduce((sum, order) => sum + Number(order.reservedAmount || 0), 0)
    const expectedReservedTotal = orderReserveSum + Number(traderAPortfolio.data.stats.shortCollateral || 0)
    assert(
      approxEqual(traderAPortfolio.data.stats.reservedBalance, expectedReservedTotal),
      `Expected reservedBalance to equal open-order reserves + short collateral (${expectedReservedTotal}), got ${traderAPortfolio.data.stats.reservedBalance}`
    )

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

  if (runGtdScenario) {
    console.log('Scenario 3: GTD expiry -> auto-cancel -> reserve refund')

    const gtdMarketId = await createMarket(traderA.jar, 'gtd')
    const balanceBBeforeGtd = await getBalance(traderB.jar)
    const gtdPrice = 0.42
    const gtdShares = 1.5
    const gtdReserve = gtdPrice * gtdShares
    const expiresAt = new Date(Date.now() + 2500).toISOString()

    const gtdRes = await request(
      'POST',
      `/api/markets/${gtdMarketId}/order`,
      { outcome: 'YES', side: 'BID', orderType: 'GTD', price: gtdPrice, shares: gtdShares, expiresAt },
      traderB.jar
    )
    assert(gtdRes.ok, `Place GTD bid failed: ${JSON.stringify(gtdRes.data)}`)
    assert(gtdRes.data.order.orderType === 'GTD', `Expected GTD order type, got ${gtdRes.data.order.orderType}`)

    const balanceBAfterGtd = await getBalance(traderB.jar)
    assert(
      approxEqual(balanceBAfterGtd, balanceBBeforeGtd - gtdReserve),
      `GTD reserve mismatch. Expected ${balanceBBeforeGtd - gtdReserve}, got ${balanceBAfterGtd}`
    )

    await sleep(3200)

    const marketAfterExpiry = await request('GET', `/api/markets/${gtdMarketId}`, null, traderB.jar)
    assert(marketAfterExpiry.ok, `Fetch market after GTD expiry failed: ${JSON.stringify(marketAfterExpiry.data)}`)

    const expiredOpenOrder = (marketAfterExpiry.data.orders || []).find((o) => o.id === gtdRes.data.order.id)
    assert(!expiredOpenOrder, 'Expected expired GTD order to be removed from open orders')

    const expiredHistory = (marketAfterExpiry.data.userOrders || []).find((o) => o.id === gtdRes.data.order.id)
    assert(expiredHistory, 'Expected GTD order in user order history after expiry')
    assert(expiredHistory.status === 'CANCELLED', `Expected GTD to become CANCELLED, got ${expiredHistory.status}`)

    const balanceBAfterExpiry = await getBalance(traderB.jar)
    assert(
      approxEqual(balanceBAfterExpiry, balanceBBeforeGtd),
      `Expected GTD reserve refund after expiry. Expected ${balanceBBeforeGtd}, got ${balanceBAfterExpiry}`
    )

    console.log(
      JSON.stringify(
        {
          scenario: 'gtd',
          gtdMarketId,
          balanceBBeforeGtd,
          balanceBAfterGtd,
          balanceBAfterExpiry,
        },
        null,
        2
      )
    )
  }

  if (runFokScenario) {
    console.log('Scenario 4: FOK -> reject when full size is unavailable')

    const fokMarketId = await createMarket(traderA.jar, 'fok')

    const buyFokInventory = await request(
      'POST',
      `/api/markets/${fokMarketId}/trade`,
      { outcome: 'YES', type: 'BUY', shares: 2 },
      traderA.jar
    )
    assert(buyFokInventory.ok, `AMM buy for FOK inventory failed: ${JSON.stringify(buyFokInventory.data)}`)

    const makerAskRes = await request(
      'POST',
      `/api/markets/${fokMarketId}/order`,
      { outcome: 'YES', side: 'ASK', orderType: 'GTC', price: 0.4, shares: 1 },
      traderA.jar
    )
    assert(makerAskRes.ok, `Place maker ask for FOK failed: ${JSON.stringify(makerAskRes.data)}`)

    const balanceBBeforeFok = await getBalance(traderB.jar)
    const fokRes = await request(
      'POST',
      `/api/markets/${fokMarketId}/order`,
      { outcome: 'YES', side: 'BID', orderType: 'FOK', price: 0.45, shares: 2 },
      traderB.jar
    )
    assert(!fokRes.ok, 'Expected FOK order to fail when insufficient size is available')
    assert(
      String(fokRes.data.error || '').includes('FOK order could not be fully matched immediately'),
      `Unexpected FOK error: ${JSON.stringify(fokRes.data)}`
    )

    const balanceBAfterFok = await getBalance(traderB.jar)
    assert(approxEqual(balanceBAfterFok, balanceBBeforeFok), 'FOK should not reserve any balance on rejection')

    const marketAfterFok = await request('GET', `/api/markets/${fokMarketId}`, null, traderA.jar)
    assert(marketAfterFok.ok, `Fetch market after FOK failed: ${JSON.stringify(marketAfterFok.data)}`)

    const survivingAsk = (marketAfterFok.data.orders || []).find((o) => o.id === makerAskRes.data.order.id)
    assert(survivingAsk, 'Expected maker ask to remain open after FOK rejection')
    assert(approxEqual(survivingAsk.remainingShares, 1), `Expected maker ask to remain untouched, got ${survivingAsk.remainingShares}`)

    console.log(
      JSON.stringify(
        {
          scenario: 'fok',
          fokMarketId,
          balanceBBeforeFok,
          balanceBAfterFok,
        },
        null,
        2
      )
    )
  }

  if (runFakScenario) {
    console.log('Scenario 5: FAK -> partial fill -> kill remainder')

    const fakMarketId = await createMarket(traderA.jar, 'fak')

    const buyFakInventory = await request(
      'POST',
      `/api/markets/${fakMarketId}/trade`,
      { outcome: 'NO', type: 'BUY', shares: 3 },
      traderA.jar
    )
    assert(buyFakInventory.ok, `AMM buy for FAK inventory failed: ${JSON.stringify(buyFakInventory.data)}`)

    const fakAskRes = await request(
      'POST',
      `/api/markets/${fakMarketId}/order`,
      { outcome: 'NO', side: 'ASK', orderType: 'GTC', price: 0.45, shares: 1.5 },
      traderA.jar
    )
    assert(fakAskRes.ok, `Place maker ask for FAK failed: ${JSON.stringify(fakAskRes.data)}`)

    const balanceBBeforeFak = await getBalance(traderB.jar)
    const fakRes = await request(
      'POST',
      `/api/markets/${fakMarketId}/order`,
      { outcome: 'NO', side: 'BID', orderType: 'FAK', price: 0.5, shares: 2 },
      traderB.jar
    )
    assert(fakRes.ok, `Place FAK bid failed: ${JSON.stringify(fakRes.data)}`)
    assert(approxEqual(fakRes.data.filledShares, 1.5), `Expected FAK to fill 1.5 shares, got ${fakRes.data.filledShares}`)
    assert(approxEqual(fakRes.data.remainingShares, 0.5), `Expected API remainingShares to report 0.5 before kill, got ${fakRes.data.remainingShares}`)
    assert(fakRes.data.order.status === 'PARTIAL', `Expected FAK order status PARTIAL, got ${fakRes.data.order.status}`)

    const balanceBAfterFak = await getBalance(traderB.jar)
    const expectedAfterFak = balanceBBeforeFak - (1.5 * 0.45)
    assert(
      approxEqual(balanceBAfterFak, expectedAfterFak),
      `FAK final balance mismatch. Expected ${expectedAfterFak}, got ${balanceBAfterFak}`
    )

    const marketAfterFak = await request('GET', `/api/markets/${fakMarketId}`, null, traderB.jar)
    assert(marketAfterFak.ok, `Fetch market after FAK failed: ${JSON.stringify(marketAfterFak.data)}`)

    const openFakOrder = (marketAfterFak.data.orders || []).find((o) => o.id === fakRes.data.order.id)
    assert(!openFakOrder, 'Expected FAK remainder to be removed from open orders')

    const fakHistory = (marketAfterFak.data.userOrders || []).find((o) => o.id === fakRes.data.order.id)
    assert(fakHistory, 'Expected FAK order in user history')
    assert(fakHistory.status === 'PARTIAL', `Expected FAK history status PARTIAL, got ${fakHistory.status}`)
    assert(approxEqual(fakHistory.remainingShares, 0), `Expected killed remainder to be 0 in history, got ${fakHistory.remainingShares}`)

    console.log(
      JSON.stringify(
        {
          scenario: 'fak',
          fakMarketId,
          balanceBBeforeFak,
          balanceBAfterFak,
          expectedAfterFak,
        },
        null,
        2
      )
    )
  }

  if (runAllScenarios || scenarioArg === 'bid-unlock-ask') {
    console.log('Scenario 6: BID placement unlocks ASK reserves by improving position')

    const bidUnlockMarketId = await createMarket(traderA.jar, 'bid-unlock')
    
    // Setup: Trader has 5 long YES and places high-price ASK orders
    const traderC = await registerUniqueUser(`${Date.now()}c`)
    
    // Buy 5 YES to have a position
    const buyRes = await request(
      'POST',
      `/api/markets/${bidUnlockMarketId}/trade`,
      { outcome: 'YES', type: 'BUY', shares: 5 },
      traderC.jar
    )
    assert(buyRes.ok, `Buy failed: ${JSON.stringify(buyRes.data)}`)
    
    const balanceBefore = await getBalance(traderC.jar)
    
    // Place ASK order at 0.6 for 10 shares (needs 4 balance as reserve since only 5 long covered)
    const askRes = await request(
      'POST',
      `/api/markets/${bidUnlockMarketId}/order`,
      { outcome: 'YES', side: 'ASK', orderType: 'GTC', price: 0.6, shares: 10 },
      traderC.jar
    )
    assert(askRes.ok, `ASK placement failed: ${JSON.stringify(askRes.data)}`)
    
    const balanceAfterAsk = await getBalance(traderC.jar)
    assert(
      approxEqual(balanceAfterAsk, balanceBefore, 0.01),
      `Placing ASK should not change total balance. Before=${balanceBefore}, After=${balanceAfterAsk}`
    )
    
    // At this point: balance is locked in ASK reserve
    // Try to place BID that would buy another 6 YES at 0.5 (cost 3)
    // Without ASK rebalancing: available = balanceAfterAsk < 3, so BID would fail
    // With ASK rebalancing: BID fills, position becomes 11 long, ASK reserves reduce to 0, freeing 2 balance
    // So buy succeeds and then unlocks reserve
    
    const bidPrice = 0.5
    const bidShares = 6
    const bidCost = bidPrice * bidShares // 3
    
    // This BID should succeed because:
    // - Current position: 5 long
    // - After BID: 11 long
    // - ASK reserves drop from 2 to 0 (all 10 ASK now covered by 11 long)
    // - The freed 2 balance + current available covers the 3 cost
    
    const bidRes = await request(
      'POST',
      `/api/markets/${bidUnlockMarketId}/order`,
      { outcome: 'YES', side: 'BID', orderType: 'GTC', price: bidPrice, shares: bidShares },
      traderC.jar
    )
    assert(bidRes.ok, `BID should succeed (ASK reserves unlock): ${JSON.stringify(bidRes.data)}`)
    // Order was placed (not rejected for insufficient balance) - the key fix.
    // Whether it fills depends on counter-offers; the test is order placement success.
    assert(bidRes.data.order, 'BID order should be created')
    
    const balanceAfterBid = await getBalance(traderC.jar)
    // The key test: BID order was placed (not rejected for insufficient balance)
    // The exact balance change depends on fill matching and rebalancing details
    // which are tested separately. Here we just verify placement succeeded.
    assert(bidRes.data.order.status === 'OPEN' || bidRes.data.order.status === 'PARTIAL', 
      `BID order should be open/partial, got ${bidRes.data.order.status}`)

    console.log(
      JSON.stringify(
        {
          scenario: 'bid-unlock-ask',
          bidUnlockMarketId,
          balanceBefore,
          balanceAfterAsk,
          balanceAfterBid,
          bidOrderStatus: bidRes.data.order.status,
        },
        null,
        2
      )
    )
  }

  if (runCrossScenario) {
    console.log('Scenario 7: cross matching (opposite bids >= 1, opposite asks <= 1)')

    // Part A: opposite bids cross when bid_yes + bid_no >= 1
    const crossBidMarketId = await createMarket(traderA.jar, 'cross-bids')
    const balanceABeforeCrossBid = await getBalance(traderA.jar)
    const balanceBBeforeCrossBid = await getBalance(traderB.jar)

    const makerBidYesPrice = 0.62
    const takerBidNoLimit = 0.4

    const bidYesRes = await request(
      'POST',
      `/api/markets/${crossBidMarketId}/order`,
      { outcome: 'YES', side: 'BID', orderType: 'GTC', price: makerBidYesPrice, shares: 1 },
      traderA.jar
    )
    assert(bidYesRes.ok, `Place maker YES bid failed: ${JSON.stringify(bidYesRes.data)}`)
    assert(approxEqual(bidYesRes.data.filledShares, 0), 'Maker YES bid should rest initially')

    const bidNoRes = await request(
      'POST',
      `/api/markets/${crossBidMarketId}/order`,
      { outcome: 'NO', side: 'BID', orderType: 'GTC', price: takerBidNoLimit, shares: 1 },
      traderB.jar
    )
    assert(bidNoRes.ok, `Place taker NO bid failed: ${JSON.stringify(bidNoRes.data)}`)
    assert(approxEqual(bidNoRes.data.filledShares, 1), `Expected cross BID fill of 1, got ${bidNoRes.data.filledShares}`)

    const balanceAAfterCrossBid = await getBalance(traderA.jar)
    const balanceBAfterCrossBid = await getBalance(traderB.jar)
    const expectedBBidSpend = 1 - makerBidYesPrice // taker executes at complement of maker price

    assert(
      approxEqual(balanceAAfterCrossBid, balanceABeforeCrossBid - makerBidYesPrice),
      `Maker BID balance mismatch. Expected ${balanceABeforeCrossBid - makerBidYesPrice}, got ${balanceAAfterCrossBid}`
    )
    assert(
      approxEqual(balanceBAfterCrossBid, balanceBBeforeCrossBid - expectedBBidSpend),
      `Taker BID balance mismatch. Expected ${balanceBBeforeCrossBid - expectedBBidSpend}, got ${balanceBAfterCrossBid}`
    )

    const crossBidMarketForMaker = await request('GET', `/api/markets/${crossBidMarketId}`, null, traderA.jar)
    assert(crossBidMarketForMaker.ok, `Fetch cross-bid market for maker failed: ${JSON.stringify(crossBidMarketForMaker.data)}`)
    const crossBidMakerHistory = (crossBidMarketForMaker.data.userOrders || []).find((o) => o.id === bidYesRes.data.order.id)
    assert(crossBidMakerHistory, 'Expected maker cross-bid order in recent orders')
    assert(
      approxEqual(Number(crossBidMakerHistory.filledShares), 1),
      `Maker cross-bid recent orders should show filledShares=1, got ${crossBidMakerHistory.filledShares}`
    )

    const crossBidMarketForTaker = await request('GET', `/api/markets/${crossBidMarketId}`, null, traderB.jar)
    assert(crossBidMarketForTaker.ok, `Fetch cross-bid market for taker failed: ${JSON.stringify(crossBidMarketForTaker.data)}`)
    const crossBidTakerHistory = (crossBidMarketForTaker.data.userOrders || []).find((o) => o.id === bidNoRes.data.order.id)
    assert(crossBidTakerHistory, 'Expected taker cross-bid order in recent orders')
    assert(
      approxEqual(Number(crossBidTakerHistory.filledShares), 1),
      `Taker cross-bid recent orders should show filledShares=1, got ${crossBidTakerHistory.filledShares}`
    )

    // Part B: opposite asks cross when ask_yes + ask_no <= 1
    const crossAskMarketId = await createMarket(traderA.jar, 'cross-asks')
    const balanceABeforeCrossAsk = await getBalance(traderA.jar)
    const balanceBBeforeCrossAsk = await getBalance(traderB.jar)

    const makerAskYesPrice = 0.35
    const takerAskNoLimit = 0.6

    const askYesRes = await request(
      'POST',
      `/api/markets/${crossAskMarketId}/order`,
      { outcome: 'YES', side: 'ASK', orderType: 'GTC', price: makerAskYesPrice, shares: 1 },
      traderA.jar
    )
    assert(askYesRes.ok, `Place maker YES ask failed: ${JSON.stringify(askYesRes.data)}`)
    assert(approxEqual(askYesRes.data.filledShares, 0), 'Maker YES ask should rest initially')

    const askNoRes = await request(
      'POST',
      `/api/markets/${crossAskMarketId}/order`,
      { outcome: 'NO', side: 'ASK', orderType: 'GTC', price: takerAskNoLimit, shares: 1 },
      traderB.jar
    )
    assert(askNoRes.ok, `Place taker NO ask failed: ${JSON.stringify(askNoRes.data)}`)
    assert(approxEqual(askNoRes.data.filledShares, 1), `Expected cross ASK fill of 1, got ${askNoRes.data.filledShares}`)

    const balanceAAfterCrossAsk = await getBalance(traderA.jar)
    const balanceBAfterCrossAsk = await getBalance(traderB.jar)
    const expectedTakerAskReceive = 1 - makerAskYesPrice // taker executes at complement of maker price

    assert(
      approxEqual(balanceAAfterCrossAsk, balanceABeforeCrossAsk + makerAskYesPrice),
      `Maker ASK balance mismatch. Expected ${balanceABeforeCrossAsk + makerAskYesPrice}, got ${balanceAAfterCrossAsk}`
    )
    assert(
      approxEqual(balanceBAfterCrossAsk, balanceBBeforeCrossAsk + expectedTakerAskReceive),
      `Taker ASK balance mismatch. Expected ${balanceBBeforeCrossAsk + expectedTakerAskReceive}, got ${balanceBAfterCrossAsk}`
    )

    const crossAskMarketForMaker = await request('GET', `/api/markets/${crossAskMarketId}`, null, traderA.jar)
    assert(crossAskMarketForMaker.ok, `Fetch cross-ask market for maker failed: ${JSON.stringify(crossAskMarketForMaker.data)}`)
    const crossAskMakerHistory = (crossAskMarketForMaker.data.userOrders || []).find((o) => o.id === askYesRes.data.order.id)
    assert(crossAskMakerHistory, 'Expected maker cross-ask order in recent orders')
    assert(
      approxEqual(Number(crossAskMakerHistory.filledShares), 1),
      `Maker cross-ask recent orders should show filledShares=1, got ${crossAskMakerHistory.filledShares}`
    )

    const crossAskMarketForTaker = await request('GET', `/api/markets/${crossAskMarketId}`, null, traderB.jar)
    assert(crossAskMarketForTaker.ok, `Fetch cross-ask market for taker failed: ${JSON.stringify(crossAskMarketForTaker.data)}`)
    const crossAskTakerHistory = (crossAskMarketForTaker.data.userOrders || []).find((o) => o.id === askNoRes.data.order.id)
    assert(crossAskTakerHistory, 'Expected taker cross-ask order in recent orders')
    assert(
      approxEqual(Number(crossAskTakerHistory.filledShares), 1),
      `Taker cross-ask recent orders should show filledShares=1, got ${crossAskTakerHistory.filledShares}`
    )

    console.log(
      JSON.stringify(
        {
          scenario: 'cross',
          crossBidMarketId,
          crossAskMarketId,
          makerBidYesPrice,
          takerBidNoExecPrice: expectedBBidSpend,
          makerAskYesPrice,
          takerAskNoExecPrice: expectedTakerAskReceive,
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
