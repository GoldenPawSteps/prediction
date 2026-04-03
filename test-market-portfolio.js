#!/usr/bin/env node
/**
 * Market Portfolio Simulation
 *
 * Focuses specifically on portfolio endpoint behavior:
 *   - baseline portfolio shape and auth enforcement
 *   - position valuation and aggregate stats coherence
 *   - reserved order accounting and short-collateral visibility
 *   - created market tracking and liquidityLocked accounting
 *   - execution venue classification (AMM vs EXCHANGE, maker vs taker)
 *
 * Run:
 *   node test-market-portfolio.js
 *   node test-market-portfolio.js basics
 *   node test-market-portfolio.js positions
 *   node test-market-portfolio.js reserves
 *   node test-market-portfolio.js created
 *   node test-market-portfolio.js exchange
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)

let passCount = 0
let failCount = 0
const failures = []
let userSeq = 0

class CookieJar {
  constructor() { this.cookies = {} }
  setCookies(headers) {
    const arr = Array.isArray(headers) ? headers : (headers ? [headers] : [])
    for (const h of arr) {
      const m = h.match(/^([^=]+)=([^;]*)/)
      if (m) this.cookies[m[1].trim()] = m[2].trim()
    }
  }
  getCookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }
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
  if (jar && setCookies.length) jar.setCookies(setCookies)

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

function approxEqual(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol
}

function assertApprox(actual, expected, msg, tol = 0.01) {
  assert(
    approxEqual(actual, expected, tol),
    `${msg}\n    expected ≈${expected.toFixed(6)}, got ${actual.toFixed(6)}, diff=${Math.abs(actual - expected).toFixed(6)} (tol ${tol})`
  )
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function pass(label) {
  passCount += 1
  console.log(`  ✅ ${label}`)
}

function fail(label, err) {
  failCount += 1
  failures.push({ label, err: err?.message || String(err) })
  console.error(`  ❌ ${label}: ${err?.message || err}`)
}

async function step(label, fn) {
  try {
    await fn()
    pass(label)
  } catch (err) {
    fail(label, err)
  }
}

async function section(name, fn) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  SECTION: ${name}`)
  console.log('═'.repeat(70))
  try {
    await fn()
  } catch (err) {
    fail(`[${name}] uncaught`, err)
  }
}

async function waitForServer() {
  process.stdout.write('⏳ Waiting for server')
  for (let i = 0; i < 120; i += 1) {
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
  throw new Error('Server did not start within 60 s')
}

async function registerAndLogin(prefix) {
  const jar = new CookieJar()
  userSeq += 1
  const suffix = `${prefix}_${RUN}_${userSeq}`
  const email = `${suffix}@test.com`
  const username = `port${RUN}${userSeq}`.slice(0, 24)

  const reg = await request('POST', '/api/auth/register', {
    email,
    username,
    password: 'password123',
  })
  assert(reg.ok, `register failed: ${JSON.stringify(reg.data)}`)

  const login = await request('POST', '/api/auth/login', {
    email,
    password: 'password123',
  }, jar)
  assert(login.ok, `login failed: ${JSON.stringify(login.data)}`)

  return { jar, user: reg.data.user }
}

async function getMe(jar) {
  const res = await request('GET', '/api/auth/me', null, jar)
  assert(res.ok, `GET /api/auth/me failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getPortfolio(jar) {
  const res = await request('GET', '/api/portfolio', null, jar)
  assert(res.ok, `GET /api/portfolio failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function createBinaryMarket(jar, suffix, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `Portfolio ${suffix} ${RUN}`,
    description: 'Automated portfolio simulation market for endpoint behavior checks.',
    category: 'Portfolio',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/portfolio',
    marketType: 'BINARY',
    initialLiquidity: 100,
    priorProbability: 0.5,
    disputeWindowHours: 1,
    ...overrides,
  }, jar)
  assert(res.ok, `create market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await request('POST', `/api/markets/${marketId}/trade`, {
    outcome,
    type,
    shares,
  }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data.trade
}

async function placeOrder(jar, marketId, payload) {
  const res = await request('POST', `/api/markets/${marketId}/order`, payload, jar)
  assert(res.ok, `place order failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function basicsSection() {
  const user = await registerAndLogin('portfolio_basics')

  await step('Authenticated portfolio returns empty baseline shape', async () => {
    const me = await getMe(user.jar)
    const portfolio = await getPortfolio(user.jar)

    assert(Array.isArray(portfolio.positions), 'positions should be an array')
    assert(Array.isArray(portfolio.trades), 'trades should be an array')
    assert(Array.isArray(portfolio.reservedOrders), 'reservedOrders should be an array')
    assert(Array.isArray(portfolio.shortReserves || []), 'shortReserves should be an array')
    assert(Array.isArray(portfolio.createdMarkets), 'createdMarkets should be an array')

    assert(portfolio.positions.length === 0, `expected no positions, got ${portfolio.positions.length}`)
    assert(portfolio.trades.length === 0, `expected no trades, got ${portfolio.trades.length}`)
    assert(portfolio.reservedOrders.length === 0, `expected no reserved orders, got ${portfolio.reservedOrders.length}`)
    assert(portfolio.createdMarkets.length === 0, `expected no created markets, got ${portfolio.createdMarkets.length}`)

    assertApprox(Number(portfolio.stats.availableBalance), Number(me.balance), 'availableBalance should match /auth/me balance', 0.001)
    assertApprox(Number(portfolio.stats.reservedBalance), 0, 'reservedBalance should be zero for fresh user', 0.001)
    assertApprox(Number(portfolio.stats.liquidityLocked), 0, 'liquidityLocked should be zero for fresh user', 0.001)
    assert(portfolio.stats.totalPositions === 0, `expected totalPositions=0, got ${portfolio.stats.totalPositions}`)
  })

  await step('Unauthenticated portfolio request is rejected', async () => {
    const res = await request('GET', '/api/portfolio')
    assert(!res.ok, 'unauthenticated /api/portfolio should fail')
    assert(res.status === 401, `expected 401, got ${res.status}`)
  })
}

async function positionsSection() {
  const creator = await registerAndLogin('portfolio_positions_creator')
  const trader = await registerAndLogin('portfolio_positions_trader')

  const market = await createBinaryMarket(creator.jar, 'Positions', {
    initialLiquidity: 120,
    priorProbability: 0.55,
  })

  await trade(trader.jar, market.id, 'YES', 'BUY', 12)
  await trade(trader.jar, market.id, 'NO', 'BUY', 4)

  await step('Positions include valuation fields and coherent per-position math', async () => {
    const portfolio = await getPortfolio(trader.jar)
    assert(portfolio.positions.length > 0, 'expected at least one open position')

    const position = portfolio.positions[0]
    assert(typeof position.currentPrice === 'number', 'position.currentPrice should be numeric')
    assert(typeof position.currentValue === 'number', 'position.currentValue should be numeric')
    assert(typeof position.unrealizedPnl === 'number', 'position.unrealizedPnl should be numeric')
    assert(typeof position.avgEntryPrice === 'number', 'position.avgEntryPrice should be numeric')
    assert(typeof position.shares === 'number', 'position.shares should be numeric')

    const expectedCurrentValue = Number(position.shares) * Number(position.currentPrice)
    const expectedUnrealized = expectedCurrentValue - (Number(position.shares) * Number(position.avgEntryPrice))
    assertApprox(Number(position.currentValue), expectedCurrentValue, 'position.currentValue should equal shares*currentPrice', 0.001)
    assertApprox(Number(position.unrealizedPnl), expectedUnrealized, 'position.unrealizedPnl should equal currentValue-costBasis', 0.001)
  })

  await step('Portfolio stats aggregate positions/trades coherently', async () => {
    const portfolio = await getPortfolio(trader.jar)
    const totalValue = portfolio.positions.reduce((sum, p) => sum + Number(p.currentValue), 0)
    const totalUnrealized = portfolio.positions.reduce((sum, p) => sum + Number(p.unrealizedPnl), 0)
    const totalRealized = portfolio.positions.reduce((sum, p) => sum + Number(p.realizedPnl), 0)

    assert(portfolio.trades.length >= 2, `expected at least 2 trades, got ${portfolio.trades.length}`)
    assert(portfolio.stats.totalPositions === portfolio.positions.length,
      `stats.totalPositions should equal positions.length (${portfolio.stats.totalPositions} vs ${portfolio.positions.length})`)
    assertApprox(Number(portfolio.stats.totalValue), totalValue, 'stats.totalValue should match positions sum', 0.001)
    assertApprox(Number(portfolio.stats.totalUnrealizedPnl), totalUnrealized, 'stats.totalUnrealizedPnl should match positions sum', 0.001)
    assertApprox(Number(portfolio.stats.totalRealizedPnl), totalRealized, 'stats.totalRealizedPnl should match positions sum', 0.001)
  })

  await step('Negative-share AMM shorts appear in positions and reserve stats', async () => {
    const shortMarket = await createBinaryMarket(trader.jar, 'SignedPositionCheck', {
      initialLiquidity: 100,
      priorProbability: 0.5,
    })

    await trade(trader.jar, shortMarket.id, 'YES', 'SELL', 6)
    const portfolio = await getPortfolio(trader.jar)
    const shortPosition = portfolio.positions.find((p) => p.market.id === shortMarket.id && p.outcome === 'YES')

    assert(shortPosition, 'short AMM position should appear in portfolio positions')
    assert(Number(shortPosition.shares) < 0, `expected negative shares, got ${shortPosition.shares}`)
    assert((portfolio.shortReserves || []).some((reserve) => reserve.marketId === shortMarket.id),
      'short reserve entry should appear for AMM short exposure')
    assert(Number(portfolio.stats.shortCollateral) > 0, 'portfolio shortCollateral should be positive when a short exists')
  })
}

async function reservesSection() {
  const creator = await registerAndLogin('portfolio_reserves_creator')
  const trader = await registerAndLogin('portfolio_reserves_trader')
  const market = await createBinaryMarket(creator.jar, 'Reserves')

  await step('Open BID reserves appear in reservedOrders and reservedBalance', async () => {
    const before = Number((await getMe(trader.jar)).balance)
    const order = await placeOrder(trader.jar, market.id, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.4,
      shares: 10,
    })

    const expectedReserve = 4
    const after = Number((await getMe(trader.jar)).balance)
    assertApprox(before - after, expectedReserve, 'balance debit should equal BID reserve amount', 0.001)

    const portfolio = await getPortfolio(trader.jar)
    assert(portfolio.reservedOrders.length > 0, 'expected at least one reserved order')
    const found = portfolio.reservedOrders.find((o) => o.id === order.order.id)
    assert(found, 'placed BID should appear in reservedOrders')
    assert(found.market && found.market.id === market.id, 'reserved order should include market metadata')

    const reservedSum = portfolio.reservedOrders.reduce((sum, o) => sum + Number(o.reservedAmount), 0)
    assertApprox(Number(portfolio.stats.reservedBalance), reservedSum,
      'stats.reservedBalance should equal sum(reservedOrders.reservedAmount)', 0.001)
    assertApprox(Number(portfolio.stats.reservedBalance), expectedReserve,
      'reservedBalance should equal expected reserve for this single order', 0.001)
  })

  await step('Naked ASK reserves appear separately from open reserved orders', async () => {
    const shortMarket = await createBinaryMarket(creator.jar, 'ShortReserveView')
    const order = await placeOrder(trader.jar, shortMarket.id, {
      outcome: 'YES',
      side: 'ASK',
      orderType: 'GTC',
      price: 0.4,
      shares: 10,
    })

    const portfolio = await getPortfolio(trader.jar)
    const found = portfolio.reservedOrders.find((o) => o.id === order.order.id)
    assert(found, 'naked ASK should appear in reservedOrders')
    assert(found.side === 'ASK', `expected reserved order side ASK, got ${found.side}`)
    assertApprox(Number(found.reservedAmount), 6,
      'initial naked ASK reservedAmount should equal shares*(1-price)', 0.001)
    assertApprox(Number(found.reservedShares), 0,
      'initial naked ASK reservedShares should be zero because no position shares are covering it', 0.001)
    assertApprox(Number(found.balanceCoveredShares), 10,
      'initial naked ASK balanceCoveredShares should match the uncovered ASK size', 0.001)
  })
}

async function createdSection() {
  const creator = await registerAndLogin('portfolio_created_creator')
  const meBefore = Number((await getMe(creator.jar)).balance)

  const m1 = await createBinaryMarket(creator.jar, 'CreatedOne', { initialLiquidity: 90 })
  const m2 = await createBinaryMarket(creator.jar, 'CreatedTwo', { initialLiquidity: 110 })

  await step('createdMarkets contains creator open markets with expected liquidity lock', async () => {
    const meAfter = Number((await getMe(creator.jar)).balance)
    const portfolio = await getPortfolio(creator.jar)

    const ids = new Set(portfolio.createdMarkets.map((m) => m.id))
    assert(ids.has(m1.id), 'first created market should appear in createdMarkets')
    assert(ids.has(m2.id), 'second created market should appear in createdMarkets')

    const lockedFromList = portfolio.createdMarkets.reduce((sum, m) => sum + Number(m.initialLiquidity), 0)
    assertApprox(Number(portfolio.stats.liquidityLocked), lockedFromList,
      'stats.liquidityLocked should equal sum(createdMarkets.initialLiquidity)', 0.001)

    assertApprox(meBefore - meAfter, 200, 'creator balance should drop by total funded liquidity', 0.001)
    assertApprox(Number(portfolio.stats.liquidityLocked), 200, 'liquidityLocked should reflect two open markets', 0.001)
  })
}

async function exchangeSection() {
  const creator = await registerAndLogin('portfolio_exchange_creator')
  const maker = await registerAndLogin('portfolio_exchange_maker')
  const taker = await registerAndLogin('portfolio_exchange_taker')

  const market = await createBinaryMarket(creator.jar, 'Exchange')

  await step('Portfolio trades classify AMM vs EXCHANGE and maker/taker roles', async () => {
    await placeOrder(maker.jar, market.id, {
      outcome: 'YES',
      side: 'ASK',
      orderType: 'GTC',
      price: 0.55,
      shares: 5,
    })

    await placeOrder(taker.jar, market.id, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.55,
      shares: 5,
    })

    const makerPortfolio = await getPortfolio(maker.jar)
    const takerPortfolio = await getPortfolio(taker.jar)

    const makerExchangeTrade = makerPortfolio.trades.find((t) => t.marketId === market.id && t.executionVenue === 'EXCHANGE')
    const takerExchangeTrade = takerPortfolio.trades.find((t) => t.marketId === market.id && t.executionVenue === 'EXCHANGE')

    assert(makerExchangeTrade, 'maker should have an EXCHANGE trade after ASK fill')
    assert(takerExchangeTrade, 'taker should have an EXCHANGE trade after BID fill')
    assert(makerExchangeTrade.exchangeRole === 'MAKER', `expected maker exchangeRole=MAKER, got ${makerExchangeTrade.exchangeRole}`)
    assert(takerExchangeTrade.exchangeRole === 'TAKER', `expected taker exchangeRole=TAKER, got ${takerExchangeTrade.exchangeRole}`)
    assert(makerExchangeTrade.type === 'SELL', `expected maker exchange trade type SELL, got ${makerExchangeTrade.type}`)
    assertApprox(Number(makerPortfolio.stats.shortCollateral), 5,
      'naked ask maker should have short collateral after the fill', 0.001)
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]

  if (!target) {
    await section('Portfolio Basics', basicsSection)
    await section('Position Valuation', positionsSection)
    await section('Reserved Order Accounting', reservesSection)
    await section('Created Markets And Liquidity Lock', createdSection)
    await section('Exchange Classification', exchangeSection)
  } else if (target === 'basics') {
    await section('Portfolio Basics', basicsSection)
  } else if (target === 'positions') {
    await section('Position Valuation', positionsSection)
  } else if (target === 'reserves') {
    await section('Reserved Order Accounting', reservesSection)
  } else if (target === 'created') {
    await section('Created Markets And Liquidity Lock', createdSection)
  } else if (target === 'exchange') {
    await section('Exchange Classification', exchangeSection)
  } else {
    console.log(`Unknown section: ${target}`)
    console.log('Valid sections: basics, positions, reserves, created, exchange')
    process.exit(1)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed`)
  console.log('═'.repeat(70))

  if (failures.length > 0) {
    console.log('\nFailures:')
    failures.forEach((failure) => {
      console.log(`- ${failure.label}`)
      console.log(`  ${failure.err}`)
    })
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.stack || err.message}`)
  process.exit(1)
})