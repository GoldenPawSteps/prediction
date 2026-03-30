#!/usr/bin/env node
/**
 * Multi-Market Multi-Trader Simulation
 *
 * Comprehensive cross-market simulation that coordinates multiple traders
 * across binary and multi-outcome markets with both AMM and exchange flows.
 *
 * Run:
 *   node test-multimarket-multitrader.js
 *   node test-multimarket-multitrader.js setup
 *   node test-multimarket-multitrader.js amm
 *   node test-multimarket-multitrader.js exchange
 *   node test-multimarket-multitrader.js validate
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)

let passCount = 0
let failCount = 0
const failures = []

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

async function section(title, fn) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  SECTION: ${title}`)
  console.log('═'.repeat(70))
  try {
    await fn()
  } catch (err) {
    fail(`[${title}] uncaught`, err)
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

let userSeq = 0
async function registerAndLogin(prefix) {
  userSeq += 1
  const jar = new CookieJar()
  const suffix = `${prefix}_${RUN}_${userSeq}`
  const email = `${suffix}@test.com`
  const username = `mmmt${RUN}${userSeq}`.slice(0, 24)

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

async function createBinaryMarket(jar, titleSuffix, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `MMMT Binary ${titleSuffix} ${RUN}`,
    description: 'Comprehensive multi-market, multi-trader simulation binary market.',
    category: 'MMMT',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/mmmt-binary',
    marketType: 'BINARY',
    initialLiquidity: 120,
    priorProbability: 0.5,
    ...overrides,
  }, jar)
  assert(res.ok, `create binary market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function createMultiMarket(jar, titleSuffix, outcomes) {
  const res = await request('POST', '/api/markets', {
    title: `MMMT Multi ${titleSuffix} ${RUN}`,
    description: 'Comprehensive multi-market, multi-trader simulation multi-outcome market.',
    category: 'MMMT',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/mmmt-multi',
    marketType: 'MULTI',
    outcomes,
  }, jar)
  assert(res.ok, `create multi market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await request('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data
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

async function getBalance(jar) {
  const res = await request('GET', '/api/auth/me', null, jar)
  assert(res.ok, `GET /api/auth/me failed: ${JSON.stringify(res.data)}`)
  const maybeDirect = Number(res.data?.balance)
  const maybeUser = Number(res.data?.user?.balance)
  if (Number.isFinite(maybeDirect)) return maybeDirect
  if (Number.isFinite(maybeUser)) return maybeUser
  throw new Error(`Could not read numeric balance from /api/auth/me: ${JSON.stringify(res.data)}`)
}

async function getPortfolio(jar) {
  const res = await request('GET', '/api/portfolio', null, jar)
  assert(res.ok, `GET /api/portfolio failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getMarket(id, jar = null) {
  const res = await request('GET', `/api/markets/${id}`, null, jar)
  assert(res.ok, `GET /api/markets/${id} failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getProbability(id) {
  const res = await request('GET', `/api/markets/${id}/probability`)
  assert(res.ok, `GET /api/markets/${id}/probability failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getLeaderboard(sortBy = 'trades') {
  const res = await request('GET', `/api/leaderboard?sortBy=${encodeURIComponent(sortBy)}`)
  assert(res.ok, `GET /api/leaderboard failed: ${JSON.stringify(res.data)}`)
  return res.data
}

function ensureSortedDesc(entries, key) {
  for (let i = 1; i < entries.length; i += 1) {
    assert(Number(entries[i - 1][key]) >= Number(entries[i][key]),
      `${key} should be descending at ${i - 1}/${i}`)
  }
}

async function buildScenario() {
  const creator = await registerAndLogin('mmmt_creator')
  const traderA = await registerAndLogin('mmmt_trader_a')
  const traderB = await registerAndLogin('mmmt_trader_b')
  const traderC = await registerAndLogin('mmmt_trader_c')

  const binaryA = await createBinaryMarket(creator.jar, 'A', { priorProbability: 0.45, initialLiquidity: 150 })
  const binaryB = await createBinaryMarket(creator.jar, 'B', { priorProbability: 0.60, initialLiquidity: 130 })
  const multiParent = await createMultiMarket(creator.jar, 'Outcomes', [
    { name: 'Alpha', initialLiquidity: 90, priorProbability: 0.5 },
    { name: 'Beta', initialLiquidity: 110, priorProbability: 0.5 },
    { name: 'Gamma', initialLiquidity: 120, priorProbability: 0.5 },
  ])

  let multiDetail = await getMarket(multiParent.id, creator.jar)
  const outcomes = multiDetail.outcomes || []
  assert(outcomes.length === 3, `expected 3 child outcomes, got ${outcomes.length}`)

  return {
    users: { creator, traderA, traderB, traderC },
    markets: {
      binaryA,
      binaryB,
      multiParent,
      childAlpha: outcomes.find((o) => o.outcomeName === 'Alpha'),
      childBeta: outcomes.find((o) => o.outcomeName === 'Beta'),
      childGamma: outcomes.find((o) => o.outcomeName === 'Gamma'),
    },
    flags: {
      ammDone: false,
      exchangeDone: false,
    },
  }
}

async function setupSection(ctx) {
  const { creator, traderA, traderB, traderC } = ctx.users
  const { binaryA, binaryB, multiParent, childAlpha, childBeta, childGamma } = ctx.markets

  await step('Users can authenticate and start with positive balances', async () => {
    const balances = await Promise.all([
      getBalance(creator.jar),
      getBalance(traderA.jar),
      getBalance(traderB.jar),
      getBalance(traderC.jar),
    ])
    balances.forEach((b, i) => assert(b > 0, `user index ${i} should have positive balance, got ${b}`))
  })

  await step('Scenario creates two binary markets and one multi parent with three children', async () => {
    assert(binaryA.marketType === 'BINARY', 'binaryA should be BINARY')
    assert(binaryB.marketType === 'BINARY', 'binaryB should be BINARY')
    assert(multiParent.marketType === 'MULTI', 'multi parent should be MULTI')
    assert(childAlpha && childBeta && childGamma, 'expected Alpha/Beta/Gamma child markets')
  })
}

async function runAmmActivity(ctx) {
  if (ctx.flags.ammDone) return

  const { traderA, traderB, traderC } = ctx.users
  const { binaryA, binaryB, childAlpha, childBeta, childGamma } = ctx.markets

  await trade(traderA.jar, binaryA.id, 'YES', 'BUY', 15)
  await trade(traderB.jar, binaryA.id, 'NO', 'BUY', 10)
  await trade(traderC.jar, binaryB.id, 'YES', 'BUY', 12)
  await trade(traderA.jar, childAlpha.id, 'YES', 'BUY', 8)
  await trade(traderB.jar, childBeta.id, 'YES', 'BUY', 6)
  await trade(traderC.jar, childGamma.id, 'NO', 'BUY', 5)
  await trade(traderA.jar, binaryA.id, 'YES', 'SELL', 4)

  ctx.flags.ammDone = true
}

async function ammSection(ctx) {
  await step('Multiple traders execute AMM trades across all markets', async () => {
    await runAmmActivity(ctx)
  })

  await step('Binary and child market probabilities stay normalized after AMM activity', async () => {
    const probs = await Promise.all([
      getProbability(ctx.markets.binaryA.id),
      getProbability(ctx.markets.binaryB.id),
      getProbability(ctx.markets.childAlpha.id),
      getProbability(ctx.markets.childBeta.id),
      getProbability(ctx.markets.childGamma.id),
    ])
    probs.forEach((p, idx) => {
      assertApprox(Number(p.yes) + Number(p.no), 1, `market prob sum at index ${idx} should be ~1`, 0.001)
      assert(Number(p.yes) > 0 && Number(p.yes) < 1, `market ${idx} yes prob should be in (0,1)`)
      assert(Number(p.no) > 0 && Number(p.no) < 1, `market ${idx} no prob should be in (0,1)`)
    })
  })
}

async function runExchangeActivity(ctx) {
  if (ctx.flags.exchangeDone) return

  await runAmmActivity(ctx)

  const { traderA, traderB, traderC } = ctx.users
  const { binaryB, binaryA } = ctx.markets

  await trade(traderB.jar, binaryB.id, 'YES', 'BUY', 9)

  const ask = await placeOrder(traderB.jar, binaryB.id, {
    outcome: 'YES',
    side: 'ASK',
    orderType: 'GTC',
    price: 0.56,
    shares: 6,
  })
  assert(ask.order, 'ask order response should include order')

  const bid = await placeOrder(traderC.jar, binaryB.id, {
    outcome: 'YES',
    side: 'BID',
    orderType: 'GTC',
    price: 0.56,
    shares: 6,
  })
  assert(Number(bid.filledShares) > 0, 'crossing bid should produce fills')

  const aBefore = await getBalance(traderA.jar)
  const reserve = await placeOrder(traderA.jar, binaryA.id, {
    outcome: 'NO',
    side: 'BID',
    orderType: 'GTC',
    price: 0.35,
    shares: 5,
  })
  const aAfterPlace = await getBalance(traderA.jar)
  await cancelOrder(traderA.jar, binaryA.id, reserve.order.id)
  const aAfterCancel = await getBalance(traderA.jar)

  assertApprox(aBefore - aAfterPlace, 1.75, 'traderA reserve should equal 0.35*5', 0.001)
  assertApprox(aAfterCancel, aBefore, 'traderA cancel should fully refund reserve', 0.001)

  ctx.flags.exchangeDone = true
}

async function exchangeSection(ctx) {
  await step('Traders perform crossing exchange orders across a shared market', async () => {
    await runExchangeActivity(ctx)
  })
}

async function validateSection(ctx) {
  await runAmmActivity(ctx)
  await runExchangeActivity(ctx)

  const { creator, traderA, traderB, traderC } = ctx.users
  const { binaryA, binaryB, multiParent, childAlpha, childBeta, childGamma } = ctx.markets

  await step('Market detail reflects volume and coherent probabilities across all active markets', async () => {
    const details = await Promise.all([
      getMarket(binaryA.id, creator.jar),
      getMarket(binaryB.id, creator.jar),
      getMarket(childAlpha.id, creator.jar),
      getMarket(childBeta.id, creator.jar),
      getMarket(childGamma.id, creator.jar),
      getMarket(multiParent.id, creator.jar),
    ])

    const [dA, dB, dAlpha, dBeta, dGamma, dMulti] = details
    assert(Number(dA.totalVolume) > 0, 'binaryA should have positive volume')
    assert(Number(dB.totalVolume) > 0, 'binaryB should have positive volume')
    assert(Number(dAlpha.totalVolume) > 0, 'Alpha child should have positive volume')
    assert(Number(dBeta.totalVolume) > 0, 'Beta child should have positive volume')
    assert(Number(dGamma.totalVolume) > 0, 'Gamma child should have positive volume')
    assert(Array.isArray(dMulti.outcomes) && dMulti.outcomes.length === 3, 'multi parent should expose 3 outcomes')

    ;[dA, dB, dAlpha, dBeta, dGamma].forEach((d, idx) => {
      assertApprox(Number(d.probabilities.yes) + Number(d.probabilities.no), 1,
        `detail probability sum for market index ${idx}`, 0.001)
    })
  })

  await step('Each trader portfolio reflects multi-market participation', async () => {
    const portfolios = await Promise.all([
      getPortfolio(traderA.jar),
      getPortfolio(traderB.jar),
      getPortfolio(traderC.jar),
    ])

    portfolios.forEach((p, idx) => {
      assert(p.trades.length > 0, `trader ${idx} should have trades in portfolio`)
      assert(typeof p.stats.totalValue === 'number', `trader ${idx} should have numeric totalValue`) 
      assert(typeof p.stats.availableBalance === 'number', `trader ${idx} should have numeric availableBalance`)
    })
  })

  await step('Creator portfolio tracks funded markets and locked liquidity', async () => {
    const creatorPortfolio = await getPortfolio(creator.jar)
    const ids = new Set(creatorPortfolio.createdMarkets.map((m) => m.id))
    assert(ids.has(binaryA.id), 'creator portfolio should include binaryA as created market')
    assert(ids.has(binaryB.id), 'creator portfolio should include binaryB as created market')
    assert(ids.has(multiParent.id), 'creator portfolio should include multi parent as created market')
    assert(Number(creatorPortfolio.stats.liquidityLocked) > 0, 'creator should have positive locked liquidity')
  })

  await step('Leaderboard trades sort remains descending during multi-trader activity', async () => {
    const leaderboard = await getLeaderboard('trades')
    assert(Array.isArray(leaderboard.entries), 'leaderboard entries should be array')
    ensureSortedDesc(leaderboard.entries, 'totalTrades')
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]
  const ctx = await buildScenario()

  if (!target) {
    await section('Scenario Setup', () => setupSection(ctx))
    await section('AMM Matrix Across Markets', () => ammSection(ctx))
    await section('Exchange Matrix Across Traders', () => exchangeSection(ctx))
    await section('Cross-Market Cross-Trader Validation', () => validateSection(ctx))
  } else if (target === 'setup') {
    await section('Scenario Setup', () => setupSection(ctx))
  } else if (target === 'amm') {
    await section('AMM Matrix Across Markets', () => ammSection(ctx))
  } else if (target === 'exchange') {
    await section('Exchange Matrix Across Traders', () => exchangeSection(ctx))
  } else if (target === 'validate') {
    await section('Cross-Market Cross-Trader Validation', () => validateSection(ctx))
  } else {
    console.log(`Unknown section: ${target}`)
    console.log('Valid sections: setup, amm, exchange, validate')
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