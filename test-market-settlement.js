#!/usr/bin/env node
/**
 * Market Settlement Simulation
 *
 * Focuses specifically on settlement behavior after resolution:
 *   S1. Provisional YES resolution stays pending until immutable finalization
 *   S2. Zero-trade settlement refunds creator liquidity exactly once
 *   S3. INVALID settlement refunds trader cost basis after finalization
 *   S4. Immutable finalization is idempotent
 *   S5. Dispute re-resolution settles only the latest outcome
 *
 * Run:
 *   node test-market-settlement.js
 *   node test-market-settlement.js core
 *   node test-market-settlement.js invalid
 *   node test-market-settlement.js dispute
 *
 * Requires:
 *   DATABASE_URL for Prisma backdating of resolutionTime
 *   Dev server at BASE_URL (default http://localhost:3001)
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)
let prisma = null
let userSeq = 0
let passed = 0
let failed = 0

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for market settlement simulation')
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
    for (const h of arr) {
      const match = h.match(/^([^=]+)=([^;]*)/)
      if (match) this.cookies[match[1].trim()] = match[2].trim()
    }
  }
  getCookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function req(method, path, body = null, jar = null) {
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

function heading(title) {
  console.log('\n' + '─'.repeat(68))
  console.log(`  Scenario: ${title}`)
  console.log('─'.repeat(68))
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
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/markets`)
      if (res.status < 500) return
    } catch {
      // retry
    }
    await sleep(500)
  }
  throw new Error('Server did not respond within 60 s')
}

async function registerUser(prefix) {
  userSeq += 1
  const jar = new CookieJar()
  const suffix = `${RUN}_${prefix}_${userSeq}`
  const res = await req('POST', '/api/auth/register', {
    email: `${suffix}@example.com`,
    username: suffix,
    password: 'password123',
  }, jar)
  assert(res.ok, `register failed for ${prefix}: ${JSON.stringify(res.data)}`)
  return { jar, user: res.data.user }
}

async function getBalance(jar) {
  const res = await req('GET', '/api/auth/me', null, jar)
  assert(res.ok, `GET /api/auth/me failed: ${JSON.stringify(res.data)}`)
  return Number(res.data.balance)
}

async function getPortfolio(jar) {
  const res = await req('GET', '/api/portfolio', null, jar)
  assert(res.ok, `GET /api/portfolio failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getMarket(marketId, jar = null) {
  const res = await req('GET', `/api/markets/${marketId}`, null, jar)
  assert(res.ok, `GET /api/markets/${marketId} failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function createMarket(jar, opts = {}) {
  const res = await req('POST', '/api/markets', {
    title: opts.title || `Settlement Market ${RUN} ${Math.random().toString(36).slice(2, 8)}`,
    description: opts.description || 'Settlement-specific simulation market validating deferred and immutable settlement.',
    category: opts.category || 'Settlement',
    endDate: opts.endDate || new Date(Date.now() + 7000).toISOString(),
    resolutionSource: opts.resolutionSource || 'https://example.com/settlement',
    initialLiquidity: opts.initialLiquidity ?? 100,
    priorProbability: opts.priorProbability ?? 0.5,
    disputeWindowHours: opts.disputeWindowHours ?? 1,
    tags: opts.tags || ['settlement', 'simulation'],
  }, jar)
  assert(res.ok, `create market failed: ${JSON.stringify(res.data)}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await req('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data.trade
}

async function resolveMarket(jar, marketId, outcome) {
  const res = await req('POST', `/api/markets/${marketId}/resolve`, { outcome }, jar)
  assert(res.ok, `resolve failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function voteMarket(jar, marketId, outcome) {
  const res = await req('POST', `/api/markets/${marketId}/vote`, { outcome }, jar)
  assert(res.ok, `vote failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function disputeMarket(jar, marketId, proposedOutcome) {
  const res = await req('POST', `/api/markets/${marketId}/dispute`, {
    proposedOutcome,
    reason: 'Settlement simulation dispute: verify latest outcome is the only one settled.',
  }, jar)
  assert(res.ok, `dispute failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function backdateResolutionTime(marketId, hours) {
  await getPrisma().market.update({
    where: { id: marketId },
    data: { resolutionTime: new Date(Date.now() - hours * 60 * 60 * 1000) },
  })
}

async function getMarketRecord(marketId) {
  return getPrisma().market.findUnique({
    where: { id: marketId },
    select: { id: true, status: true, resolution: true, settledAt: true, resolutionTime: true },
  })
}

async function triggerFinalization(jar, marketId, backdateHours = 2) {
  await backdateResolutionTime(marketId, backdateHours)
  await sleep(100)
  const portfolio = await getPortfolio(jar)
  await sleep(150)
  return portfolio
}

async function scenarioDeferredYesSettlement() {
  heading('S1/S4 — provisional YES stays pending, immutable finalization settles once')

  const creator = await registerUser('s1creator')
  const trader = await registerUser('s1trader')
  const initialLiquidity = 100
  const market = await createMarket(creator.jar, {
    initialLiquidity,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 6000).toISOString(),
  })

  const creatorStart = await getBalance(creator.jar)
  const traderStart = await getBalance(trader.jar)
  const buy = await trade(trader.jar, market.id, 'YES', 'BUY', 40)

  await sleep(6600)
  await getMarket(market.id)

  const resolved = await resolveMarket(creator.jar, market.id, 'YES')
  const creatorPendingPortfolio = await getPortfolio(creator.jar)
  const traderPendingPortfolio = await getPortfolio(trader.jar)
  const traderPendingBalance = await getBalance(trader.jar)
  const pendingDetail = await getMarket(market.id, trader.jar)

  await check('S1a: resolve marks settlement as pending and keeps market RESOLVED', async () => {
    assert(resolved.settlementPending === true, 'resolve should report settlementPending=true')
    assert(pendingDetail.status === 'RESOLVED', `expected RESOLVED, got ${pendingDetail.status}`)
    assert(pendingDetail.resolution === 'YES', `expected YES resolution, got ${pendingDetail.resolution}`)
  })

  await check('S1b: before finalization creator liquidity stays locked and trader is unpaid', async () => {
    assertApprox(creatorPendingPortfolio.stats.liquidityLocked, initialLiquidity,
      'creator liquidity should remain locked during dispute window', 0.001)
    assert(traderPendingPortfolio.stats.totalPositions > 0,
      `trader should still have open positions, got ${traderPendingPortfolio.stats.totalPositions}`)
    assertApprox(traderPendingBalance, traderStart - buy.totalCost,
      'trader balance should remain debited before finalization', 0.02)
  })

  const firstFinalizePortfolio = await triggerFinalization(creator.jar, market.id, 2)
  const creatorAfterFirstFinalize = await getBalance(creator.jar)
  const traderAfterFirstFinalize = await getBalance(trader.jar)
  const secondFinalizePortfolio = await getPortfolio(creator.jar)
  const creatorAfterSecondFinalize = await getBalance(creator.jar)
  const traderAfterFinalPortfolio = await getPortfolio(trader.jar)
  const record = await getMarketRecord(market.id)

  await check('S4a: immutable finalization unlocks liquidity, closes positions, and sets settledAt', async () => {
    assertApprox(firstFinalizePortfolio.stats.liquidityLocked, 0,
      'creator liquidity should unlock after immutable finalization', 0.001)
    assert(traderAfterFinalPortfolio.stats.totalPositions === 0,
      `trader positions should be closed after finalization, got ${traderAfterFinalPortfolio.stats.totalPositions}`)
    assert(!!record.settledAt, 'settledAt should be set after finalization')
  })

  await check('S4b: finalization pays winning trader and refunds creator exactly once', async () => {
    const expectedTrader = traderStart - buy.totalCost + 40
    assertApprox(traderAfterFirstFinalize, expectedTrader,
      'winning trader should be paid only at finalization', 0.02)
    assert(creatorAfterFirstFinalize > creatorStart - initialLiquidity,
      'creator should recover locked liquidity after finalization')
    assertApprox(creatorAfterSecondFinalize, creatorAfterFirstFinalize,
      'creator balance should not change on repeated finalization trigger', 0.001)
    assertApprox(secondFinalizePortfolio.stats.liquidityLocked, 0,
      'liquidity should remain unlocked on repeated finalization trigger', 0.001)
  })
}

async function scenarioZeroTradeSettlement() {
  heading('S2 — zero-trade settlement returns creator liquidity exactly once')

  const creator = await registerUser('s2creator')
  const initialLiquidity = 150
  const creatorStart = await getBalance(creator.jar)
  const market = await createMarket(creator.jar, {
    initialLiquidity,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 5000).toISOString(),
  })

  const creatorAfterCreate = await getBalance(creator.jar)
  await sleep(5600)
  await getMarket(market.id)
  const resolved = await resolveMarket(creator.jar, market.id, 'YES')
  assert(resolved.settlementPending === true, 'zero-trade resolution should still be provisional first')

  await triggerFinalization(creator.jar, market.id, 2)
  const creatorAfterFinalize = await getBalance(creator.jar)
  const creatorAfterSecondTrigger = await getBalance(creator.jar)

  await check('S2a: creator balance drops by initialLiquidity at create time', async () => {
    assertApprox(creatorAfterCreate, creatorStart - initialLiquidity,
      'creator balance should reflect locked liquidity immediately after create', 0.001)
  })

  await check('S2b: creator fully recovers initialLiquidity after zero-trade finalization', async () => {
    assertApprox(creatorAfterFinalize, creatorStart,
      'creator should recover full initialLiquidity when no traders participated', 0.02)
    assertApprox(creatorAfterSecondTrigger, creatorAfterFinalize,
      'zero-trade finalization should be idempotent', 0.001)
  })
}

async function scenarioInvalidSettlement() {
  heading('S3 — INVALID finalization refunds trader cost basis and unlocks creator liquidity')

  const creator = await registerUser('s3creator')
  const trader = await registerUser('s3trader')
  const market = await createMarket(creator.jar, {
    initialLiquidity: 80,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 6000).toISOString(),
  })

  const creatorAfterCreate = await getBalance(creator.jar)
  const traderStart = await getBalance(trader.jar)
  const buy = await trade(trader.jar, market.id, 'YES', 'BUY', 20)

  await sleep(6600)
  await getMarket(market.id)
  const invalid = await resolveMarket(creator.jar, market.id, 'INVALID')
  const pendingDetail = await getMarket(market.id, trader.jar)
  const pendingBalance = await getBalance(trader.jar)

  await check('S3a: INVALID resolution is provisional first and displays neutral probabilities', async () => {
    assert(invalid.settlementPending === true, 'INVALID resolve should still be settlementPending first')
    assert(pendingDetail.status === 'INVALID', `expected INVALID status, got ${pendingDetail.status}`)
    assertApprox(pendingDetail.probabilities.yes, 0.5, 'INVALID yes probability should be 0.5', 0.0001)
    assertApprox(pendingDetail.probabilities.no, 0.5, 'INVALID no probability should be 0.5', 0.0001)
  })

  await check('S3b: trader is not refunded before finalization', async () => {
    assertApprox(pendingBalance, traderStart - buy.totalCost,
      'trader cost basis should remain debited before INVALID finalization', 0.02)
  })

  const creatorPortfolioAfter = await triggerFinalization(creator.jar, market.id, 2)
  const traderPortfolioAfter = await getPortfolio(trader.jar)
  const traderAfter = await getBalance(trader.jar)
  const creatorAfter = await getBalance(creator.jar)

  await check('S3c: INVALID finalization refunds cost basis, closes positions, and unlocks liquidity', async () => {
    assertApprox(creatorPortfolioAfter.stats.liquidityLocked, 0,
      'creator liquidity should unlock after INVALID finalization', 0.001)
    assert(traderPortfolioAfter.stats.totalPositions === 0,
      'trader positions should close after INVALID finalization')
    assertApprox(traderAfter, traderStart,
      'trader should get full cost-basis refund on INVALID', 0.02)
    assert(creatorAfter > creatorAfterCreate,
      'creator should recover locked liquidity after INVALID finalization')
  })
}

async function scenarioDisputeLatestOutcomeSettlement() {
  heading('S5 — dispute re-resolution finalizes latest outcome only')

  const creator = await registerUser('s5creator')
  const yesTrader = await registerUser('s5yes')
  const noTrader = await registerUser('s5no')
  const market = await createMarket(creator.jar, {
    initialLiquidity: 100,
    disputeWindowHours: 720,
    endDate: new Date(Date.now() + 6000).toISOString(),
  })

  const yesStart = await getBalance(yesTrader.jar)
  const noStart = await getBalance(noTrader.jar)
  const yesBuy = await trade(yesTrader.jar, market.id, 'YES', 'BUY', 30)
  const noBuy = await trade(noTrader.jar, market.id, 'NO', 'BUY', 25)

  await sleep(6600)
  await getMarket(market.id)

  const firstVote = await voteMarket(creator.jar, market.id, 'YES')
  const firstResolved = await getMarket(market.id)

  await check('S5a: first vote provisionally resolves market to YES', async () => {
    assert(firstVote.autoResolved === true, 'first vote should auto-resolve round 0')
    assert(firstResolved.status === 'RESOLVED', `expected RESOLVED, got ${firstResolved.status}`)
    assert(firstResolved.resolution === 'YES', `expected provisional YES, got ${firstResolved.resolution}`)
  })

  await disputeMarket(noTrader.jar, market.id, 'NO')
  const disputed = await getMarket(market.id)

  await check('S5b: dispute moves market to DISPUTED without paying either side', async () => {
    assert(disputed.status === 'DISPUTED', `expected DISPUTED, got ${disputed.status}`)
    assert(disputed.disputes.length > 0, 'dispute should be visible on market detail')
    const yesPending = await getBalance(yesTrader.jar)
    const noPending = await getBalance(noTrader.jar)
    assertApprox(yesPending, yesStart - yesBuy.totalCost,
      'YES trader should remain unpaid during dispute window', 0.02)
    assertApprox(noPending, noStart - noBuy.totalCost,
      'NO trader should remain unpaid during dispute window', 0.02)
  })

  const revote1 = await voteMarket(yesTrader.jar, market.id, 'NO')
  const stillDisputed = await getMarket(market.id)
  const revote2 = await voteMarket(noTrader.jar, market.id, 'NO')
  const reResolved = await getMarket(market.id)

  await check('S5c: dispute round requires quorum and then re-resolves to NO', async () => {
    assert(revote1.autoResolved === false, 'first dispute-round vote should not resolve yet')
    assert(stillDisputed.status === 'DISPUTED', `expected DISPUTED after first re-vote, got ${stillDisputed.status}`)
    assert(revote2.autoResolved === true, 'second dispute-round vote should resolve market')
    assert(reResolved.status === 'RESOLVED', `expected RESOLVED after quorum, got ${reResolved.status}`)
    assert(reResolved.resolution === 'NO', `latest resolution should be NO, got ${reResolved.resolution}`)
  })

  await triggerFinalization(creator.jar, market.id, 721)
  const yesPortfolio = await getPortfolio(yesTrader.jar)
  const noPortfolio = await getPortfolio(noTrader.jar)
  const yesAfter = await getBalance(yesTrader.jar)
  const noAfter = await getBalance(noTrader.jar)

  await check('S5d: finalization settles only latest NO outcome and closes both positions', async () => {
    assert(yesPortfolio.stats.totalPositions === 0, 'YES trader position should close after finalization')
    assert(noPortfolio.stats.totalPositions === 0, 'NO trader position should close after finalization')
    assertApprox(yesAfter, yesStart - yesBuy.totalCost,
      'YES trader should not receive payout after latest outcome flips to NO', 0.02)
    assertApprox(noAfter, noStart - noBuy.totalCost + 25,
      'NO trader should receive payout from latest final NO outcome', 0.02)
  })
}

async function main() {
  const mode = (process.argv[2] || 'all').toLowerCase()

  if (!['all', 'core', 'invalid', 'dispute'].includes(mode)) {
    console.error(`Unknown mode: ${mode}. Use all | core | invalid | dispute`)
    process.exit(1)
  }

  console.log('════════════════════════════════════════════════════════════════════════')
  console.log('  Market Settlement Simulation')
  console.log('════════════════════════════════════════════════════════════════════════')
  console.log(`  BASE_URL : ${BASE_URL}`)
  console.log(`  Mode     : ${mode}`)
  console.log(`  Run tag  : ${RUN}`)

  await waitForServer()

  if (mode === 'all' || mode === 'core') {
    await scenarioDeferredYesSettlement()
    await scenarioZeroTradeSettlement()
  }
  if (mode === 'all' || mode === 'invalid') {
    await scenarioInvalidSettlement()
  }
  if (mode === 'all' || mode === 'dispute') {
    await scenarioDisputeLatestOutcomeSettlement()
  }

  console.log('\n' + '════════════════════════════════════════════════════════════════════════')
  console.log(`  RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`)
  console.log('════════════════════════════════════════════════════════════════════════')

  if (failed > 0) process.exit(1)
}

main()
  .catch((err) => {
    console.error('\nFatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect()
  })