#!/usr/bin/env node
/**
 * Market Balance Simulation
 *
 * Focuses specifically on user balance behavior:
 *   - baseline wallet and portfolio available-balance sync
 *   - market creation liquidity funding debits
 *   - AMM BUY/SELL balance exactness, including short opens
 *   - exchange BID reserve, cancel refund, and naked-ASK collateral effects
 *   - rejected operations do not mutate balances
 *
 * Run:
 *   node test-market-balance.js
 *   node test-market-balance.js wallet
 *   node test-market-balance.js funding
 *   node test-market-balance.js amm
 *   node test-market-balance.js exchange
 *   node test-market-balance.js rejections
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
  userSeq += 1
  const jar = new CookieJar()
  const suffix = `${prefix}_${RUN}_${userSeq}`
  const email = `${suffix}@test.com`
  const username = `bal${RUN}${userSeq}`.slice(0, 24)

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

async function getBalance(jar) {
  return Number((await getMe(jar)).balance)
}

async function getPortfolio(jar) {
  const res = await request('GET', '/api/portfolio', null, jar)
  assert(res.ok, `GET /api/portfolio failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function createBinaryMarket(jar, suffix, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `Balance ${suffix} ${RUN}`,
    description: 'Automated balance simulation market for wallet accounting checks.',
    category: 'Balance',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/balance',
    marketType: 'BINARY',
    initialLiquidity: 100,
    priorProbability: 0.5,
    ...overrides,
  }, jar)
  assert(res.ok, `create market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
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

async function walletSection() {
  const user = await registerAndLogin('balance_wallet')

  await step('Fresh user starts with positive wallet balance', async () => {
    const me = await getMe(user.jar)
    assert(Number(me.balance) > 0, `expected positive starting balance, got ${me.balance}`)
  })

  await step('Portfolio availableBalance matches /auth/me', async () => {
    const me = await getMe(user.jar)
    const portfolio = await getPortfolio(user.jar)
    assertApprox(Number(portfolio.stats.availableBalance), Number(me.balance),
      'portfolio availableBalance should match auth balance', 0.001)
  })

  await step('Unauthenticated /api/auth/me and /api/portfolio are rejected', async () => {
    const meRes = await request('GET', '/api/auth/me')
    const portfolioRes = await request('GET', '/api/portfolio')
    assert(!meRes.ok, 'unauth /api/auth/me should fail')
    assert(!portfolioRes.ok, 'unauth /api/portfolio should fail')
  })
}

async function fundingSection() {
  const creator = await registerAndLogin('balance_funding')

  await step('Market creation debits balance by exact initialLiquidity', async () => {
    const before = await getBalance(creator.jar)
    const market = await createBinaryMarket(creator.jar, 'Funding', { initialLiquidity: 135 })
    const after = await getBalance(creator.jar)
    const portfolio = await getPortfolio(creator.jar)

    assert(market.initialLiquidity === 135, `expected created market initialLiquidity 135, got ${market.initialLiquidity}`)
    assertApprox(before - after, 135, 'creator balance should decrease by initialLiquidity', 0.001)
    assertApprox(Number(portfolio.stats.liquidityLocked), 135,
      'portfolio liquidityLocked should include created market liquidity', 0.001)
  })
}

async function ammSection() {
  const creator = await registerAndLogin('balance_amm_creator')
  const trader = await registerAndLogin('balance_amm_trader')
  const market = await createBinaryMarket(creator.jar, 'AMM')

  await step('AMM BUY decreases balance by trade.totalCost', async () => {
    const before = await getBalance(trader.jar)
    const buyTrade = await trade(trader.jar, market.id, 'YES', 'BUY', 20)
    const after = await getBalance(trader.jar)

    assert(Number(buyTrade.totalCost) > 0, `BUY totalCost should be positive, got ${buyTrade.totalCost}`)
    assertApprox(before - after, Number(buyTrade.totalCost),
      'BUY should debit balance by exact totalCost', 0.001)
  })

  await step('AMM SELL increases balance by absolute trade.totalCost', async () => {
    const before = await getBalance(trader.jar)
    const sellTrade = await trade(trader.jar, market.id, 'YES', 'SELL', 8)
    const after = await getBalance(trader.jar)

    assert(Number(sellTrade.totalCost) < 0, `SELL totalCost should be negative, got ${sellTrade.totalCost}`)
    assertApprox(after - before, Math.abs(Number(sellTrade.totalCost)),
      'SELL should credit balance by absolute totalCost', 0.001)
  })

  await step('AMM short open credits proceeds minus newly locked collateral', async () => {
    const shortMarket = await createBinaryMarket(creator.jar, 'AMMShort')
    const before = await getBalance(trader.jar)
    const shortTrade = await trade(trader.jar, shortMarket.id, 'YES', 'SELL', 10)
    const after = await getBalance(trader.jar)
    const portfolio = await getPortfolio(trader.jar)

    assert(Number(shortTrade.totalCost) < 0, `short SELL totalCost should be negative, got ${shortTrade.totalCost}`)
    assertApprox(after - before, Math.abs(Number(shortTrade.totalCost)) - 10,
      'AMM short should move available balance by proceeds minus collateral lock', 0.01)
    assertApprox(Number(portfolio.stats.shortCollateral), 10,
      'portfolio shortCollateral should reflect the short exposure payoff cap', 0.001)
  })
}

async function exchangeSection() {
  const creator = await registerAndLogin('balance_ex_creator')
  const buyer = await registerAndLogin('balance_ex_buyer')
  const seller = await registerAndLogin('balance_ex_seller')
  const market = await createBinaryMarket(creator.jar, 'Exchange')

  await step('BID order reserves exact price*shares and cancel refunds fully', async () => {
    const before = await getBalance(buyer.jar)
    const orderResp = await placeOrder(buyer.jar, market.id, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.42,
      shares: 10,
    })
    const afterPlace = await getBalance(buyer.jar)
    const expectedReserve = 4.2

    assertApprox(before - afterPlace, expectedReserve, 'BID should reserve price*shares', 0.001)
    await cancelOrder(buyer.jar, market.id, orderResp.order.id)
    const afterCancel = await getBalance(buyer.jar)
    assertApprox(afterCancel, before, 'cancel should restore full reserved amount', 0.001)
  })

  await step('Exchange fill transfers value between users with no net money creation', async () => {
    // seller inventory for ASK
    await trade(seller.jar, market.id, 'YES', 'BUY', 12)

    const sumBefore = (await getBalance(buyer.jar)) + (await getBalance(seller.jar))

    await placeOrder(seller.jar, market.id, {
      outcome: 'YES',
      side: 'ASK',
      orderType: 'GTC',
      price: 0.55,
      shares: 6,
    })

    const buyerBeforeBid = await getBalance(buyer.jar)
    const bid = await placeOrder(buyer.jar, market.id, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.55,
      shares: 6,
    })
    const buyerAfterBid = await getBalance(buyer.jar)
    const sellerAfterFill = await getBalance(seller.jar)
    const sumAfter = buyerAfterBid + sellerAfterFill

    assert(Number(bid.filledShares) > 0, 'crossing BID should fill at least partially')
    assertApprox(buyerBeforeBid - buyerAfterBid, 3.3, 'buyer reserve/use should be 0.55*6', 0.001)
    assertApprox(sumAfter, sumBefore, 'exchange fill should preserve combined buyer+seller balance', 0.001)
  })

  await step('Naked ASK fill leaves seller available balance unchanged while reserve grows', async () => {
    const shortMarket = await createBinaryMarket(creator.jar, 'ExchangeShort')
    const sellerBeforePlace = await getBalance(seller.jar)

    await placeOrder(seller.jar, shortMarket.id, {
      outcome: 'YES',
      side: 'ASK',
      orderType: 'GTC',
      price: 0.4,
      shares: 10,
    })

    const sellerAfterPlace = await getBalance(seller.jar)
    assertApprox(sellerBeforePlace - sellerAfterPlace, 6,
      'placing naked ASK should lock initial reserve of shares*(1-price)', 0.001)

    await placeOrder(buyer.jar, shortMarket.id, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.4,
      shares: 5,
    })

    const sellerAfterFill = await getBalance(seller.jar)
    const sellerPortfolio = await getPortfolio(seller.jar)
    assertApprox(sellerAfterFill, sellerAfterPlace,
      'buyer payment on naked ASK fill should go into collateral, not available balance', 0.001)
    assertApprox(Number(sellerPortfolio.stats.reservedBalance), 8,
      'seller reserved balance should increase to reflect filled short exposure', 0.01)
  })
}

async function rejectionSection() {
  const creator = await registerAndLogin('balance_reject_creator')
  const trader = await registerAndLogin('balance_reject_trader')
  const market = await createBinaryMarket(creator.jar, 'Rejects', { initialLiquidity: 100 })

  await step('Rejected oversized AMM BUY does not change balance', async () => {
    const before = await getBalance(trader.jar)
    const res = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: 100000,
    }, trader.jar)
    const after = await getBalance(trader.jar)

    assert(!res.ok, 'oversized BUY should be rejected')
    assertApprox(after, before, 'rejected BUY must not mutate balance', 0.001)
  })

  await step('Rejected invalid order payload does not change balance', async () => {
    const before = await getBalance(trader.jar)
    const res = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 2,
      shares: 5,
    }, trader.jar)
    const after = await getBalance(trader.jar)

    assert(!res.ok, 'invalid order should be rejected')
    assertApprox(after, before, 'rejected order must not mutate balance', 0.001)
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]

  if (!target) {
    await section('Wallet Baseline', walletSection)
    await section('Market Funding Debits', fundingSection)
    await section('AMM Balance Movement', ammSection)
    await section('Exchange Balance Movement', exchangeSection)
    await section('Rejected Mutations', rejectionSection)
  } else if (target === 'wallet') {
    await section('Wallet Baseline', walletSection)
  } else if (target === 'funding') {
    await section('Market Funding Debits', fundingSection)
  } else if (target === 'amm') {
    await section('AMM Balance Movement', ammSection)
  } else if (target === 'exchange') {
    await section('Exchange Balance Movement', exchangeSection)
  } else if (target === 'rejections') {
    await section('Rejected Mutations', rejectionSection)
  } else {
    console.log(`Unknown section: ${target}`)
    console.log('Valid sections: wallet, funding, amm, exchange, rejections')
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