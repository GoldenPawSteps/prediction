#!/usr/bin/env node
/**
 * Market Liquidity Simulation
 *
 * Focuses specifically on liquidity behavior:
 *   - creator balance and portfolio liquidity lock on market creation
 *   - multi-outcome liquidity aggregation and child liquidity propagation
 *   - higher liquidity causing lower price impact for the same trade size
 *   - creator liquidity staying locked through provisional resolution and unlocking after finalization
 *
 * Run:
 *   node test-market-liquidity.js
 *   node test-market-liquidity.js lock
 *   node test-market-liquidity.js sensitivity
 *   node test-market-liquidity.js multi
 *   node test-market-liquidity.js unlock
 *
 * Requires:
 *   DATABASE_URL for the unlock section (Prisma backdating of resolutionTime)
 *   Dev server at BASE_URL (default http://localhost:3001)
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)

let prisma = null
let passCount = 0
let failCount = 0
const failures = []
let userSeq = 0

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for liquidity unlock checks')
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
  constructor() { this.cookies = {} }
  setCookies(headers) {
    const arr = Array.isArray(headers) ? headers : (headers ? [headers] : [])
    for (const header of arr) {
      const match = header.match(/^([^=]+)=([^;]*)/)
      if (match) this.cookies[match[1].trim()] = match[2].trim()
    }
  }
  getCookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join('; ')
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

async function registerAndLogin(prefix) {
  const jar = new CookieJar()
  userSeq += 1
  const suffix = `${prefix}_${RUN}_${userSeq}`
  const email = `${suffix}@test.com`
  const username = `liq${RUN}${userSeq}`.slice(0, 24)

  const register = await request('POST', '/api/auth/register', {
    email,
    username,
    password: 'password123',
  })
  assert(register.ok, `register failed: ${JSON.stringify(register.data)}`)

  const login = await request('POST', '/api/auth/login', {
    email,
    password: 'password123',
  }, jar)
  assert(login.ok, `login failed: ${JSON.stringify(login.data)}`)

  return { jar, user: register.data.user }
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

async function getMarket(marketId, jar = null) {
  const res = await request('GET', `/api/markets/${marketId}`, null, jar)
  assert(res.ok, `GET /api/markets/${marketId} failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getProbability(marketId) {
  const res = await request('GET', `/api/markets/${marketId}/probability`)
  assert(res.ok, `GET /api/markets/${marketId}/probability failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function createBinaryMarket(jar, suffix, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `Liquidity ${suffix} ${RUN}`,
    description: 'Automated liquidity simulation market validating lock accounting and price sensitivity.',
    category: 'Liquidity',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/liquidity',
    marketType: 'BINARY',
    initialLiquidity: 100,
    priorProbability: 0.5,
    disputeWindowHours: 1,
    ...overrides,
  }, jar)
  assert(res.ok, `create binary market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function createMultiMarket(jar, suffix, outcomes, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `Liquidity Multi ${suffix} ${RUN}`,
    description: 'Automated liquidity simulation multi market validating child liquidity propagation.',
    category: 'Liquidity',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/liquidity-multi',
    marketType: 'MULTI',
    outcomes,
    disputeWindowHours: 1,
    ...overrides,
  }, jar)
  assert(res.ok, `create multi market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await request('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data.trade
}

async function resolveMarket(jar, marketId, outcome) {
  const res = await request('POST', `/api/markets/${marketId}/resolve`, { outcome }, jar)
  assert(res.ok, `resolve failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function triggerFinalization(jar, marketId, backdateHours = 2) {
  await getPrisma().market.update({
    where: { id: marketId },
    data: { resolutionTime: new Date(Date.now() - backdateHours * 60 * 60 * 1000) },
  })
  await sleep(100)
  const portfolio = await getPortfolio(jar)
  await sleep(150)
  return portfolio
}

async function lockSection() {
  const creator = await registerAndLogin('liq_lock_creator')
  const startBalance = Number((await getMe(creator.jar)).balance)
  const market = await createBinaryMarket(creator.jar, 'BinaryLock', {
    initialLiquidity: 120,
    priorProbability: 0.65,
  })
  const afterBalance = Number((await getMe(creator.jar)).balance)
  const portfolio = await getPortfolio(creator.jar)

  await step('Binary creation debits creator by exact initial liquidity', async () => {
    assertApprox(startBalance - afterBalance, 120, 'creator balance should drop by exact initial liquidity', 0.001)
  })

  await step('Portfolio liquidityLocked reflects open binary market funding', async () => {
    assertApprox(portfolio.stats.availableBalance, afterBalance, 'available balance should match /auth/me balance', 0.001)
    assertApprox(portfolio.stats.liquidityLocked, 120, 'liquidityLocked should equal binary market funding', 0.001)
    assert(portfolio.createdMarkets.some((created) => created.id === market.id), 'created market should appear in portfolio.createdMarkets')
  })

  await step('Created binary market exposes positive liquidity parameter', async () => {
    const detail = await getMarket(market.id, creator.jar)
    assert(detail.initialLiquidity === 120, `expected initialLiquidity 120, got ${detail.initialLiquidity}`)
    assert(Number(detail.liquidityParam) > 0, `expected positive liquidityParam, got ${detail.liquidityParam}`)
  })
}

async function sensitivitySection() {
  const creator = await registerAndLogin('liq_sensitivity_creator')
  const trader = await registerAndLogin('liq_sensitivity_trader')

  const lowMarket = await createBinaryMarket(creator.jar, 'Low', { initialLiquidity: 40, priorProbability: 0.5 })
  const highMarket = await createBinaryMarket(creator.jar, 'High', { initialLiquidity: 400, priorProbability: 0.5 })

  await step('Higher funded market receives higher liquidity parameter', async () => {
    const lowDetail = await getMarket(lowMarket.id, creator.jar)
    const highDetail = await getMarket(highMarket.id, creator.jar)
    assert(Number(highDetail.liquidityParam) > Number(lowDetail.liquidityParam),
      `expected high-liquidity param > low-liquidity param (${highDetail.liquidityParam} vs ${lowDetail.liquidityParam})`)
  })

  await step('Same YES buy moves low-liquidity market more than high-liquidity market', async () => {
    const lowBefore = await getProbability(lowMarket.id)
    const highBefore = await getProbability(highMarket.id)

    const lowTrade = await trade(trader.jar, lowMarket.id, 'YES', 'BUY', 10)
    const highTrade = await trade(trader.jar, highMarket.id, 'YES', 'BUY', 10)

    const lowAfter = await getProbability(lowMarket.id)
    const highAfter = await getProbability(highMarket.id)

    const lowMove = lowAfter.yes - lowBefore.yes
    const highMove = highAfter.yes - highBefore.yes

    assert(lowMove > highMove, `expected larger probability move in low-liquidity market (${lowMove} vs ${highMove})`)
    assert(lowTrade.totalCost > highTrade.totalCost,
      `expected same trade size to cost more in low-liquidity market (${lowTrade.totalCost} vs ${highTrade.totalCost})`)
  })
}

async function multiSection() {
  const creator = await registerAndLogin('liq_multi_creator')
  const startBalance = Number((await getMe(creator.jar)).balance)
  const market = await createMultiMarket(creator.jar, 'Children', [
    { name: 'Alpha', initialLiquidity: 50, priorProbability: 0.5 },
    { name: 'Beta', initialLiquidity: 150, priorProbability: 0.5 },
    { name: 'Gamma', initialLiquidity: 300, priorProbability: 0.5 },
  ])
  const afterBalance = Number((await getMe(creator.jar)).balance)
  const portfolio = await getPortfolio(creator.jar)
  const detail = await getMarket(market.id, creator.jar)

  await step('Multi market debits creator by sum of child liquidities', async () => {
    assertApprox(startBalance - afterBalance, 500, 'multi market should debit sum of child liquidities', 0.001)
    assertApprox(portfolio.stats.liquidityLocked, 500, 'portfolio should lock summed child liquidity', 0.001)
  })

  await step('Multi parent exposes summed initialLiquidity and three child outcomes', async () => {
    assert(detail.marketType === 'MULTI', `expected MULTI marketType, got ${detail.marketType}`)
    assert(detail.initialLiquidity === 500, `expected parent initialLiquidity 500, got ${detail.initialLiquidity}`)
    assert(Array.isArray(detail.outcomes), 'expected outcomes array on multi market')
    assert(detail.outcomes.length === 3, `expected 3 outcomes, got ${detail.outcomes.length}`)
  })

  await step('Child liquidity parameters increase with child initial liquidity', async () => {
    const alpha = detail.outcomes.find((outcome) => outcome.outcomeName === 'Alpha')
    const beta = detail.outcomes.find((outcome) => outcome.outcomeName === 'Beta')
    const gamma = detail.outcomes.find((outcome) => outcome.outcomeName === 'Gamma')
    const createdChildren = Array.isArray(market.children) ? market.children : []
    const createdAlpha = createdChildren.find((child) => child.outcomeName === 'Alpha')
    const createdBeta = createdChildren.find((child) => child.outcomeName === 'Beta')
    const createdGamma = createdChildren.find((child) => child.outcomeName === 'Gamma')

    assert(alpha && beta && gamma, 'expected Alpha/Beta/Gamma child outcomes')
    assert(createdAlpha && createdBeta && createdGamma, 'expected Alpha/Beta/Gamma in create response children')
    assert(Number(createdAlpha.initialLiquidity) === 50, `expected Alpha initialLiquidity 50, got ${createdAlpha.initialLiquidity}`)
    assert(Number(createdBeta.initialLiquidity) === 150, `expected Beta initialLiquidity 150, got ${createdBeta.initialLiquidity}`)
    assert(Number(createdGamma.initialLiquidity) === 300, `expected Gamma initialLiquidity 300, got ${createdGamma.initialLiquidity}`)
    assert(Number(beta.liquidityParam) > Number(alpha.liquidityParam),
      `expected Beta liquidityParam > Alpha (${beta.liquidityParam} vs ${alpha.liquidityParam})`)
    assert(Number(gamma.liquidityParam) > Number(beta.liquidityParam),
      `expected Gamma liquidityParam > Beta (${gamma.liquidityParam} vs ${beta.liquidityParam})`)
  })
}

async function unlockSection() {
  const creator = await registerAndLogin('liq_unlock_creator')
  const creatorStart = Number((await getMe(creator.jar)).balance)
  const market = await createBinaryMarket(creator.jar, 'Unlock', {
    initialLiquidity: 140,
    endDate: new Date(Date.now() + 3500).toISOString(),
    disputeWindowHours: 1,
  })

  const afterCreate = Number((await getMe(creator.jar)).balance)
  const pendingPortfolio = await getPortfolio(creator.jar)

  await step('Open market keeps creator liquidity locked before resolution', async () => {
    assertApprox(creatorStart - afterCreate, 140, 'creator should fund open market with 140', 0.001)
    assertApprox(pendingPortfolio.stats.liquidityLocked, 140, 'open market should keep 140 locked', 0.001)
  })

  await sleep(3800)
  await getMarket(market.id, creator.jar)
  const resolved = await resolveMarket(creator.jar, market.id, 'YES')
  const afterResolvePortfolio = await getPortfolio(creator.jar)

  await step('Provisional resolution keeps creator liquidity locked', async () => {
    assert(resolved.settlementPending === true, 'resolve should report settlementPending=true')
    assertApprox(afterResolvePortfolio.stats.liquidityLocked, 140,
      'creator liquidity should stay locked until immutable finalization', 0.001)
  })

  await step('Immutable finalization unlocks creator liquidity exactly once', async () => {
    await triggerFinalization(creator.jar, market.id)
    const finalizedPortfolio = await getPortfolio(creator.jar)
    const finalizedBalance = Number((await getMe(creator.jar)).balance)

    assertApprox(finalizedPortfolio.stats.liquidityLocked, 0, 'creator liquidity should unlock after finalization', 0.001)
    assertApprox(finalizedBalance, creatorStart, 'zero-trade finalization should restore creator starting balance', 0.02)

    await getPortfolio(creator.jar)
    const secondBalance = Number((await getMe(creator.jar)).balance)
    assertApprox(secondBalance, finalizedBalance, 'finalization should not refund liquidity twice', 0.001)
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]

  if (!target) {
    await section('Liquidity Locking', lockSection)
    await section('Liquidity Sensitivity', sensitivitySection)
    await section('Multi-Outcome Liquidity', multiSection)
    await section('Liquidity Unlock', unlockSection)
  } else if (target === 'lock') {
    await section('Liquidity Locking', lockSection)
  } else if (target === 'sensitivity') {
    await section('Liquidity Sensitivity', sensitivitySection)
  } else if (target === 'multi') {
    await section('Multi-Outcome Liquidity', multiSection)
  } else if (target === 'unlock') {
    await section('Liquidity Unlock', unlockSection)
  } else {
    console.error(`Unknown section: ${target}`)
    console.error('Valid sections: lock, sensitivity, multi, unlock')
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

  if (prisma) await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(`\nFatal error: ${err.stack || err.message}`)
  if (prisma) await prisma.$disconnect()
  process.exit(1)
})