#!/usr/bin/env node
require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)

let userSeq = 0
let passed = 0
let failed = 0
let prisma = null

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for short-selling simulations')
  }
  if (!prisma) {
    const { PrismaClient } = require('@prisma/client')
    const { PrismaPg } = require('@prisma/adapter-pg')
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    prisma = new PrismaClient({ adapter })
  }
  return prisma
}

class CookieJar {
  constructor() {
    this.cookies = {}
  }

  setCookies(headers) {
    const values = Array.isArray(headers) ? headers : (headers ? [headers] : [])
    for (const header of values) {
      const match = header.match(/^([^=]+)=([^;]*)/)
      if (match) this.cookies[match[1].trim()] = match[2].trim()
    }
  }

  getCookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join('; ')
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function request(method, path, body = null, jar = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (jar) headers.Cookie = jar.getCookieHeader()

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  })

  const setCookies = res.headers.getSetCookie?.() || []
  if (jar && setCookies.length > 0) {
    jar.setCookies(setCookies)
  }

  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  return { ok: res.ok, status: res.status, data }
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

function approxEqual(a, b, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance
}

function assertApprox(actual, expected, message, tolerance = 0.01) {
  assert(
    approxEqual(actual, expected, tolerance),
    `${message}\n    expected ≈${expected.toFixed(6)}, got ${actual.toFixed(6)}, diff=${Math.abs(actual - expected).toFixed(6)} (tol ${tolerance})`
  )
}

function heading(title) {
  console.log('\n' + '─'.repeat(72))
  console.log(`  Scenario: ${title}`)
  console.log('─'.repeat(72))
}

async function check(title, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✅ ${title}`)
  } catch (err) {
    failed += 1
    console.log(`  ❌ ${title}`)
    console.log(`     ${err.message}`)
  }
}

async function waitForServer() {
  process.stdout.write('⏳ Waiting for server')
  for (let index = 0; index < 120; index += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/markets`)
      if (res.status < 500) {
        console.log(' ✓')
        return
      }
    } catch {
    }
    process.stdout.write('.')
    await sleep(500)
  }
  throw new Error('Server did not respond within 60 s')
}

async function registerUser(prefix) {
  userSeq += 1
  const suffix = `${prefix}_${RUN}_${userSeq}`
  const jar = new CookieJar()
  const email = `${suffix}@example.com`
  const usernamePrefix = prefix.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10) || 'user'
  const username = `${usernamePrefix}_${RUN.slice(-6)}_${userSeq}`.slice(0, 24)

  const res = await request('POST', '/api/auth/register', {
    email,
    username,
    password: 'password123',
  }, jar)

  assert(res.ok, `register failed: ${JSON.stringify(res.data)}`)
  return { jar, user: res.data.user }
}

async function createMarket(jar, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: overrides.title || `Short Selling ${RUN} ${Math.random().toString(36).slice(2, 8)}`,
    description: 'Short-selling runtime simulation market.',
    category: 'Short Selling',
    endDate: overrides.endDate || new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: overrides.resolutionSource || 'https://example.com/short-selling',
    marketType: 'BINARY',
    initialLiquidity: overrides.initialLiquidity ?? 100,
    priorProbability: overrides.priorProbability ?? 0.5,
    disputeWindowHours: overrides.disputeWindowHours ?? 1,
  }, jar)

  assert(res.ok, `create market failed: ${JSON.stringify(res.data)}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await request('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data.trade
}

async function placeOrder(jar, marketId, payload) {
  const res = await request('POST', `/api/markets/${marketId}/order`, payload, jar)
  assert(res.ok, `place order failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function cancelOrder(jar, marketId, orderId) {
  const res = await request('DELETE', `/api/markets/${marketId}/order`, { orderId }, jar)
  assert(res.ok, `cancel order failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function resolveMarket(jar, marketId, outcome) {
  const res = await request('POST', `/api/markets/${marketId}/resolve`, { outcome }, jar)
  assert(res.ok, `resolve failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getBalance(jar) {
  const res = await request('GET', '/api/auth/me', null, jar)
  assert(res.ok, `GET /api/auth/me failed: ${JSON.stringify(res.data)}`)
  return Number(res.data.balance)
}

async function getPortfolio(jar) {
  const res = await request('GET', '/api/portfolio', null, jar)
  assert(res.ok, `GET /api/portfolio failed: ${JSON.stringify(res.data)}`)
  return res.data
}

function getPosition(portfolio, marketId, outcome) {
  return (portfolio.positions || []).find((position) => position.marketId === marketId && position.outcome === outcome)
}

async function backdateResolutionTime(marketId, hours) {
  await getPrisma().market.update({
    where: { id: marketId },
    data: { resolutionTime: new Date(Date.now() - hours * 60 * 60 * 1000) },
  })
}

async function ammShortOpenCoverScenario() {
  heading('AMM short open/cover')

  const creator = await registerUser('ss_creator_amm')
  const trader = await registerUser('ss_trader_amm')
  const market = await createMarket(creator.jar, { title: 'AMM short open cover' })

  const beforeBalance = await getBalance(trader.jar)
  const shortTrade = await trade(trader.jar, market.id, 'YES', 'SELL', 10)
  const afterShortBalance = await getBalance(trader.jar)
  const shortPortfolio = await getPortfolio(trader.jar)
  const shortPosition = getPosition(shortPortfolio, market.id, 'YES')

  await check('AMM short opens a negative position and locks reserve', async () => {
    assert(Number(shortTrade.totalCost) < 0, `short sell totalCost should be negative, got ${shortTrade.totalCost}`)
    assert(shortPosition, 'expected YES position after opening short')
    assert(Number(shortPosition.shares) < 0, `expected negative shares, got ${shortPosition.shares}`)
    assertApprox(Number(shortPosition.shares), -10, 'short position shares should equal sold size', 0.001)
    assertApprox(
      afterShortBalance - beforeBalance,
      Math.abs(Number(shortTrade.totalCost)) - 10,
      'available balance should move by proceeds minus new collateral lock',
      0.01
    )
    assertApprox(Number(shortPortfolio.stats.shortCollateral), 10, 'short collateral should equal worst-case payoff', 0.001)
  })

  const beforeCoverBalance = await getBalance(trader.jar)
  const coverTrade = await trade(trader.jar, market.id, 'YES', 'BUY', 10)
  const afterCoverBalance = await getBalance(trader.jar)
  const afterCoverPortfolio = await getPortfolio(trader.jar)
  const afterCoverPosition = getPosition(afterCoverPortfolio, market.id, 'YES')

  await check('AMM cover closes the short and releases collateral', async () => {
    assert(Number(coverTrade.totalCost) > 0, `cover buy totalCost should be positive, got ${coverTrade.totalCost}`)
    assert(!afterCoverPosition, 'position should be closed after full cover')
    assertApprox(Number(afterCoverPortfolio.stats.shortCollateral), 0, 'short collateral should be released after cover', 0.001)
    assertApprox(
      afterCoverBalance - beforeCoverBalance,
      10 - Number(coverTrade.totalCost),
      'cover should release collateral and pay trade cost',
      0.01
    )
  })
}

async function exchangeNakedAskScenario() {
  heading('Exchange naked ask fill')

  const creator = await registerUser('ss_creator_ex')
  const seller = await registerUser('ss_seller_ex')
  const buyer = await registerUser('ss_buyer_ex')
  const market = await createMarket(creator.jar, { title: 'Exchange naked ask' })

  const sellerBefore = await getBalance(seller.jar)
  await placeOrder(seller.jar, market.id, {
    outcome: 'YES',
    side: 'ASK',
    orderType: 'GTC',
    price: 0.4,
    shares: 10,
  })
  const sellerAfterAskPlace = await getBalance(seller.jar)
  const sellerPortfolioAfterPlace = await getPortfolio(seller.jar)

  await check('Placing 10 ASK @0.4 locks initial reserve of 6', async () => {
    assertApprox(sellerAfterAskPlace - sellerBefore, -6, 'placing naked ask should lock 10 - 10*0.4', 0.01)
    assertApprox(Number(sellerPortfolioAfterPlace.stats.reservedBalance), 6, 'reserved balance should include initial ask reserve', 0.01)
  })

  const firstBidFill = await placeOrder(buyer.jar, market.id, {
    outcome: 'YES',
    side: 'BID',
    orderType: 'GTC',
    price: 0.4,
    shares: 5,
  })

  const sellerAfterFirstFill = await getBalance(seller.jar)
  const sellerPortfolioAfterFirstFill = await getPortfolio(seller.jar)

  await check('First fill of 5 increases locked reserve to 8 total', async () => {
    assert(Number(firstBidFill.filledShares) > 0, 'first crossing bid should fill')
    assertApprox(sellerAfterFirstFill - sellerBefore, -6, 'balance unchanged as buyer payment absorbed into collateral', 0.01)
    assertApprox(Number(sellerPortfolioAfterFirstFill.stats.reservedBalance), 8,
      'reserved balance should include open ASK reserve (3) plus short collateral (5)', 0.01)
    assertApprox(Number(sellerPortfolioAfterFirstFill.stats.shortCollateral), 5,
      'short collateral should be 5 after first fill creates a -5 position', 0.01)
    assertApprox(Number(sellerPortfolioAfterFirstFill.stats.lockedBalance), 8,
      'total locked balance should be 8 after first fill', 0.01)
  })

  const secondBidFill = await placeOrder(buyer.jar, market.id, {
    outcome: 'YES',
    side: 'BID',
    orderType: 'GTC',
    price: 0.4,
    shares: 5,
  })

  const sellerAfter = await getBalance(seller.jar)
  const sellerPortfolio = await getPortfolio(seller.jar)
  const sellerPosition = getPosition(sellerPortfolio, market.id, 'YES')
  const buyerPortfolio = await getPortfolio(buyer.jar)
  const buyerPosition = getPosition(buyerPortfolio, market.id, 'YES')

  await check('Second fill completes order and moves locked reserve to 10', async () => {
    assert(Number(secondBidFill.filledShares) > 0, 'second crossing bid should fill remaining shares')
    assertApprox(sellerAfter - sellerBefore, -6, 'balance still unchanged after second fill - all payments absorbed into collateral', 0.01)
    assertApprox(Number(sellerPortfolio.stats.reservedBalance), 10,
      'reserved balance should equal short collateral after open ASK reserve is fully released', 0.01)
    assertApprox(Number(sellerPortfolio.stats.shortCollateral), 10,
      'short collateral should be 10 after full fill creates a -10 position', 0.01)
    assertApprox(Number(sellerPortfolio.stats.lockedBalance), 10,
      'total locked balance should be 10 after full fill', 0.01)
  })

  await check('Exchange naked ask fills and leaves seller short with collateral', async () => {
    assert(sellerPosition, 'seller should have a resulting short position')
    assert(Number(sellerPosition.shares) < 0, `seller should be short, got ${sellerPosition.shares}`)
    assertApprox(Number(sellerPosition.shares), -10, 'seller short position should equal total fill size', 0.001)
    assert(buyerPosition, 'buyer should have resulting long position')
    assertApprox(Number(buyerPosition.shares), 10, 'buyer long position should equal total fill size', 0.001)
    assertApprox(Number(sellerPortfolio.stats.shortCollateral), 10, 'seller short collateral should equal fill size', 0.001)
  })
}

async function askReserveRebalanceOnBuyScenario() {
  heading('Short ask reserve rebalances on buy')

  const creator = await registerUser('ss_creator_rebalance')
  const trader = await registerUser('ss_trader_rebalance')
  const market = await createMarket(creator.jar, { title: 'Short ask rebalance on buy' })

  const balanceBeforeAsk = await getBalance(trader.jar)
  await placeOrder(trader.jar, market.id, {
    outcome: 'YES',
    side: 'ASK',
    orderType: 'GTC',
    price: 0.4,
    shares: 10,
  })

  const balanceAfterAsk = await getBalance(trader.jar)
  const portfolioAfterAsk = await getPortfolio(trader.jar)

  await check('Initial 10@0.4 naked ASK locks reserve of 6', async () => {
    assertApprox(balanceAfterAsk - balanceBeforeAsk, -6, 'initial reserve should be 10*(1-0.4)=6', 0.01)
    const askOrder = (portfolioAfterAsk.reservedOrders || []).find(
      (order) => order.marketId === market.id && order.side === 'ASK' && Number(order.remainingShares) > 0
    )
    assert(askOrder, 'open ASK order should appear in reservedOrders')
    assertApprox(Number(askOrder.reservedAmount), 6, 'order reservedAmount should be 6 initially', 0.01)
  })

  const buyTrade = await trade(trader.jar, market.id, 'YES', 'BUY', 3)

  const balanceAfterBuy = await getBalance(trader.jar)
  const portfolioAfterBuy = await getPortfolio(trader.jar)

  await check('Buying 3 YES reduces corresponding short ASK reserve to 4.2', async () => {
    const askOrder = (portfolioAfterBuy.reservedOrders || []).find(
      (order) => order.marketId === market.id && order.side === 'ASK' && Number(order.remainingShares) > 0
    )
    assert(askOrder, 'open ASK order should still be present after buy')
    assertApprox(Number(askOrder.reservedAmount), 4.2, 'updated reserve should be (10-3)*(1-0.4)=4.2', 0.01)

    const reserveRelease = 6 - 4.2
    const buyCost = Number(buyTrade.totalCost)
    assertApprox(
      balanceAfterBuy - balanceAfterAsk,
      reserveRelease - buyCost,
      'balance change after buy should include reserve release minus buy cost',
      0.02
    )
  })
}

async function askReserveRebalanceOnCancelScenario() {
  heading('ASK reserve rebalances on cancel')

  const creator = await registerUser('ss_creator_cancel')
  const trader = await registerUser('ss_trader_cancel')
  const market = await createMarket(creator.jar, { title: 'ASK reserve rebalance on cancel' })

  await trade(trader.jar, market.id, 'YES', 'BUY', 2)

  const askA = await placeOrder(trader.jar, market.id, {
    outcome: 'YES',
    side: 'ASK',
    orderType: 'GTC',
    price: 0.6,
    shares: 5,
  })

  const askB = await placeOrder(trader.jar, market.id, {
    outcome: 'YES',
    side: 'ASK',
    orderType: 'GTC',
    price: 0.5,
    shares: 10,
  })

  const beforeCancelPortfolio = await getPortfolio(trader.jar)
  const beforeA = (beforeCancelPortfolio.reservedOrders || []).find((order) => order.id === askA.order.id)
  const beforeB = (beforeCancelPortfolio.reservedOrders || []).find((order) => order.id === askB.order.id)

  await check('Pre-cancel allocation uses ascending-price priority', async () => {
    assert(beforeA, 'expected first ASK order in reservedOrders')
    assert(beforeB, 'expected second ASK order in reservedOrders')

    assertApprox(Number(beforeA.reservedShares), 0, '5@0.6 should have 0 locked shares before cancel', 0.001)
    assertApprox(Number(beforeA.reservedAmount), 2, '5@0.6 reserve should be 2 before cancel', 0.001)

    assertApprox(Number(beforeB.reservedShares), 2, '10@0.5 should have 2 locked shares before cancel', 0.001)
    assertApprox(Number(beforeB.reservedAmount), 4, '10@0.5 reserve should be 4 before cancel', 0.001)
  })

  await cancelOrder(trader.jar, market.id, askB.order.id)

  const afterCancelPortfolio = await getPortfolio(trader.jar)
  const afterA = (afterCancelPortfolio.reservedOrders || []).find((order) => order.id === askA.order.id)

  await check('Cancelling 10@0.5 reallocates shares to 5@0.6 and lowers reserve to 1.2', async () => {
    assert(afterA, 'expected surviving ASK order in reservedOrders after cancel')
    assertApprox(Number(afterA.reservedShares), 2, '5@0.6 should have 2 locked shares after cancel', 0.001)
    assertApprox(Number(afterA.reservedAmount), 1.2, '5@0.6 reserve should be 3*(1-0.6)=1.2 after cancel', 0.001)
  })
}

async function bidReserveRebalancesOnAskCancelScenario() {
  heading('BID reserve rebalances on ASK cancel')

  const creator = await registerUser('ss_creator_bid_cancel')
  const trader = await registerUser('ss_trader_bid_cancel')
  const market = await createMarket(creator.jar, { title: 'BID reserve rebalance on ASK cancel' })

  // Seed a small long position so ASK orders can partially use share coverage.
  await trade(trader.jar, market.id, 'YES', 'BUY', 2)

  const ask = await placeOrder(trader.jar, market.id, {
    outcome: 'YES',
    side: 'ASK',
    orderType: 'GTC',
    price: 0.6,
    shares: 5,
  })

  const bid = await placeOrder(trader.jar, market.id, {
    outcome: 'YES',
    side: 'BID',
    orderType: 'GTC',
    price: 0.5,
    shares: 2,
  })

  const beforeCancelPortfolio = await getPortfolio(trader.jar)
  const bidBeforeCancel = (beforeCancelPortfolio.reservedOrders || []).find((order) => order.id === bid.order.id)

  await check('BID reserve is reduced while ASK exists (due to release on execution)', async () => {
    assert(bidBeforeCancel, 'expected BID order in reservedOrders before cancel')
    assertApprox(Number(bidBeforeCancel.reservedAmount), 0.2, 'expected BID reserve 0.2 before ASK cancel', 0.001)
  })

  await cancelOrder(trader.jar, market.id, ask.order.id)

  const afterCancelPortfolio = await getPortfolio(trader.jar)
  const bidAfterCancel = (afterCancelPortfolio.reservedOrders || []).find((order) => order.id === bid.order.id)

  await check('Cancelling ASK increases BID reserve to full gross payment', async () => {
    assert(bidAfterCancel, 'expected BID order in reservedOrders after ASK cancel')
    assertApprox(Number(bidAfterCancel.reservedAmount), 1.0, 'expected BID reserve 1.0 after ASK cancel', 0.001)
  })
}

async function settlementShortScenario() {
  heading('Settlement payout on short winners/losers')

  const creator = await registerUser('ss_creator_settle')
  const shortWinner = await registerUser('ss_short_winner')
  const shortLoser = await registerUser('ss_short_loser')
  const winnerMarket = await createMarket(creator.jar, {
    title: 'Short winner market',
    disputeWindowHours: 1,
  })
  const loserMarket = await createMarket(creator.jar, {
    title: 'Short loser market',
    disputeWindowHours: 1,
  })

  const winnerStart = await getBalance(shortWinner.jar)
  const loserStart = await getBalance(shortLoser.jar)
  const winnerShortTrade = await trade(shortWinner.jar, winnerMarket.id, 'NO', 'SELL', 4)
  const loserShortTrade = await trade(shortLoser.jar, loserMarket.id, 'YES', 'SELL', 4)

  await resolveMarket(creator.jar, winnerMarket.id, 'YES')
  await resolveMarket(creator.jar, loserMarket.id, 'YES')
  await backdateResolutionTime(winnerMarket.id, 2)
  await backdateResolutionTime(loserMarket.id, 2)

  const beforeFinalizeWinner = await getBalance(shortWinner.jar)
  const beforeFinalizeLoser = await getBalance(shortLoser.jar)
  const winnerPortfolioAfterFinalize = await getPortfolio(shortWinner.jar)
  const loserPortfolioAfterFinalize = await getPortfolio(shortLoser.jar)
  const afterFinalizeWinner = Number(winnerPortfolioAfterFinalize.stats.availableBalance)
  const afterFinalizeLoser = Number(loserPortfolioAfterFinalize.stats.availableBalance)

  await check('Short winner keeps proceeds and receives collateral release at finalization', async () => {
    assert(!getPosition(winnerPortfolioAfterFinalize, winnerMarket.id, 'NO'), 'short winner position should be closed after settlement')
    assertApprox(Number(winnerPortfolioAfterFinalize.stats.shortCollateral), 0, 'short winner collateral should be released', 0.001)
    assertApprox(
      afterFinalizeWinner - beforeFinalizeWinner,
      4,
      'short winner should receive released collateral at finalization',
      0.01
    )
    assert(winnerStart !== beforeFinalizeWinner, 'pre-finalization balance should differ after opening short')
    assert(Number(winnerShortTrade.totalCost) < 0, 'winner short opening trade should have negative totalCost')
  })

  await check('Short loser pays winning payout out of locked collateral on finalization', async () => {
    assert(!getPosition(loserPortfolioAfterFinalize, loserMarket.id, 'YES'), 'short loser position should be closed after settlement')
    assertApprox(Number(loserPortfolioAfterFinalize.stats.shortCollateral), 0, 'short loser collateral should be released/consumed after settlement', 0.001)
    assertApprox(
      afterFinalizeLoser - beforeFinalizeLoser,
      0,
      'short loser should not gain available balance on finalization because collateral is consumed by payout',
      0.01
    )
    assert(Number(loserShortTrade.totalCost) < 0, 'loser short opening trade should have negative totalCost')
    assert(beforeFinalizeLoser < loserStart, 'short loser should have lower available balance before finalization due to collateral lock')
  })
}

async function main() {
  await waitForServer()
  await ammShortOpenCoverScenario()
  await exchangeNakedAskScenario()
  await askReserveRebalanceOnBuyScenario()
  await askReserveRebalanceOnCancelScenario()
  await bidReserveRebalancesOnAskCancelScenario()
  await settlementShortScenario()

  console.log('\n' + '═'.repeat(72))
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`)
  console.log('═'.repeat(72))

  if (prisma) {
    await prisma.$disconnect()
  }

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(async (err) => {
  console.error(err)
  if (prisma) {
    await prisma.$disconnect()
  }
  process.exit(1)
})