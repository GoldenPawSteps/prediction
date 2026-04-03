#!/usr/bin/env node
/**
 * Market Lifecycle Simulation
 *
 * Focuses on end-to-end market state transitions and user-visible side effects:
 *
 *   L1. OPEN market creation locks creator liquidity and is visible in list/detail
 *   L2. Expiry auto-closes market, cancels open BID orders, refunds reserves, blocks trading
 *   L3. Provisional resolution keeps liquidity locked and positions open during dispute window
 *   L4. Immutable finalization unlocks liquidity, closes positions, and is idempotent
 *   L5. INVALID lifecycle refunds positions after finalization
 *   L6. Dispute -> re-vote -> re-resolution finalizes the latest outcome only
 *   L7. Short positions remain pending during dispute window and settle correctly at finalization
 *
 * Run:
 *   node test-market-lifecycle.js
 *   node test-market-lifecycle.js core
 *   node test-market-lifecycle.js invalid
 *   node test-market-lifecycle.js dispute
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)
let userSeq = 0
let passed = 0
let failed = 0
let prisma = null

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for market lifecycle simulation')
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
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/markets`)
      if (res.status < 500) return
    } catch {
      // retry
    }
    await sleep(500)
  }
  throw new Error('Server did not respond within 20 s')
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
  assert(res.ok, `GET market ${marketId} failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function listMarkets(query = '') {
  const res = await req('GET', `/api/markets${query}`)
  assert(res.ok, `GET /api/markets failed: ${JSON.stringify(res.data)}`)
  return res.data.markets
}

async function createMarket(jar, opts = {}) {
  const res = await req('POST', '/api/markets', {
    title: opts.title || `Lifecycle Market ${RUN} ${Math.random().toString(36).slice(2, 8)}`,
    description: opts.description || 'Lifecycle simulation market that verifies state transitions end to end.',
    category: opts.category || 'Test',
    endDate: opts.endDate || new Date(Date.now() + 4000).toISOString(),
    resolutionSource: opts.resolutionSource || 'https://example.com/lifecycle',
    initialLiquidity: opts.initialLiquidity ?? 100,
    priorProbability: opts.priorProbability ?? 0.5,
    disputeWindowHours: opts.disputeWindowHours ?? 1,
    tags: opts.tags || ['lifecycle', 'simulation'],
  }, jar)
  assert(res.ok, `create market failed: ${JSON.stringify(res.data)}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await req('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data.trade
}

async function placeOrder(jar, marketId, body) {
  const res = await req('POST', `/api/markets/${marketId}/order`, body, jar)
  assert(res.ok, `place order failed: ${JSON.stringify(res.data)}`)
  return res.data
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
    reason: 'Lifecycle simulation dispute: the provisional outcome should be reconsidered and re-resolved.',
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
    select: { status: true, resolution: true, resolutionTime: true, settledAt: true },
  })
}

async function scenarioOpenAndExpiryLifecycle() {
  heading('L1/L2 — OPEN creation, expiry auto-close, order cancellation, trading lock')

  const creator = await registerUser('l1creator')
  const bidder = await registerUser('l1bidder')
  const initialLiquidity = 120
  const startCreatorBalance = await getBalance(creator.jar)
  const startBidderBalance = await getBalance(bidder.jar)

  const market = await createMarket(creator.jar, {
    initialLiquidity,
    endDate: new Date(Date.now() + 8000).toISOString(),
  })

  const creatorAfterCreate = await getBalance(creator.jar)
  const detailOpen = await getMarket(market.id, creator.jar)
  const listedOpen = (await listMarkets('?status=OPEN')).find((m) => m.id === market.id)
  const creatorPortfolio = await getPortfolio(creator.jar)

  await check('L1a: creator liquidity is locked immediately on market creation', async () => {
    assertApprox(creatorAfterCreate, startCreatorBalance - initialLiquidity,
      'creator balance should decrease by initialLiquidity', 0.001)
    assertApprox(creatorPortfolio.stats.liquidityLocked, initialLiquidity,
      'portfolio liquidityLocked should reflect the newly created market', 0.001)
  })

  await check('L1b: new market is visible as OPEN in detail and list views', async () => {
    assert(detailOpen.status === 'OPEN', `detail status should be OPEN, got ${detailOpen.status}`)
    assert(!!listedOpen, 'market should appear in the OPEN markets list')
  })

  const reservePrice = 0.42
  const reserveShares = 10
  const reservedAmount = reservePrice * reserveShares
  const orderResult = await placeOrder(bidder.jar, market.id, {
    outcome: 'YES',
    side: 'BID',
    orderType: 'GTC',
    price: reservePrice,
    shares: reserveShares,
  })
  const bidderAfterBid = await getBalance(bidder.jar)

  await check('L2a: open BID reserves funds while market is still OPEN', async () => {
    assertApprox(startBidderBalance - bidderAfterBid, reservedAmount,
      'bidder balance decrease should equal reserved notional', 0.001)
    assert(orderResult.order.status === 'OPEN', `new order should be OPEN, got ${orderResult.order.status}`)
  })

  await sleep(8600)
  const detailClosed = await getMarket(market.id, bidder.jar)
  const bidderAfterClose = await getBalance(bidder.jar)
  const bidderView = await getMarket(market.id, bidder.jar)

  await check('L2b: expired market auto-closes on detail fetch', async () => {
    assert(detailClosed.status === 'CLOSED', `expected CLOSED after expiry, got ${detailClosed.status}`)
  })

  await check('L2c: closing the market cancels open BID orders and refunds reserves', async () => {
    const userOrder = bidderView.userOrders.find((order) => order.id === orderResult.order.id)
    assert(!!userOrder, 'cancelled order should still appear in userOrders history')
    assert(userOrder.status === 'CANCELLED', `order status should be CANCELLED, got ${userOrder.status}`)
    assertApprox(bidderAfterClose, startBidderBalance,
      'bidder balance should be fully refunded when market closes', 0.001)
  })

  await check('L2d: CLOSED markets reject both AMM trades and exchange orders', async () => {
    const tradeRes = await req('POST', `/api/markets/${market.id}/trade`, { outcome: 'YES', type: 'BUY', shares: 5 }, bidder.jar)
    const orderRes = await req('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTC', price: 0.5, shares: 5,
    }, bidder.jar)
    assert(!tradeRes.ok, 'trade should fail on CLOSED market')
    assert(!orderRes.ok, 'order should fail on CLOSED market')
  })
}

async function scenarioProvisionalAndFinalSettlement() {
  heading('L3/L4 — provisional resolution keeps state pending, finalization settles once')

  const creator = await registerUser('l3creator')
  const trader = await registerUser('l3trader')
  const initialLiquidity = 100
  const market = await createMarket(creator.jar, {
    initialLiquidity,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 8000).toISOString(),
  })

  const traderBefore = await getBalance(trader.jar)
  const creatorAfterCreate = await getBalance(creator.jar)
  const buy = await trade(trader.jar, market.id, 'YES', 'BUY', 40)

  await sleep(8600)
  await getMarket(market.id)

  const resolveResult = await resolveMarket(creator.jar, market.id, 'YES')
  const creatorPortfolioPending = await getPortfolio(creator.jar)
  const traderPortfolioPending = await getPortfolio(trader.jar)
  const detailPending = await getMarket(market.id, trader.jar)
  const traderPendingBalance = await getBalance(trader.jar)

  await check('L3a: resolving a CLOSED market records provisional YES resolution', async () => {
    assert(resolveResult.settlementPending === true, 'resolve response should mark settlementPending=true')
    assert(detailPending.status === 'RESOLVED', `detail status should be RESOLVED, got ${detailPending.status}`)
    assert(detailPending.resolution === 'YES', `detail resolution should be YES, got ${detailPending.resolution}`)
  })

  await check('L3b: during dispute window, liquidity stays locked and winning position remains open', async () => {
    assertApprox(creatorPortfolioPending.stats.liquidityLocked, initialLiquidity,
      'creator liquidity should still be locked before immutable finalization', 0.001)
    assert(traderPortfolioPending.stats.totalPositions > 0,
      `trader should still have open positions, got ${traderPortfolioPending.stats.totalPositions}`)
    assertApprox(traderPendingBalance, traderBefore - buy.totalCost,
      'trader should not be paid out before finalization', 0.01)
  })

  await check('L3c: RESOLVED markets reject new trades and new orders while pending finalization', async () => {
    const tradeRes = await req('POST', `/api/markets/${market.id}/trade`, { outcome: 'YES', type: 'BUY', shares: 5 }, trader.jar)
    const orderRes = await req('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTC', price: 0.55, shares: 5,
    }, trader.jar)
    assert(!tradeRes.ok, 'trade should fail on RESOLVED market')
    assert(!orderRes.ok, 'order should fail on RESOLVED market')
  })

  await backdateResolutionTime(market.id, 2)
  const firstFinalizePortfolio = await getPortfolio(creator.jar)
  const creatorBalanceAfterFirstFinalize = await getBalance(creator.jar)
  const secondFinalizePortfolio = await getPortfolio(creator.jar)
  const creatorBalanceAfterSecondFinalize = await getBalance(creator.jar)
  const traderAfterFinalize = await getPortfolio(trader.jar)
  const marketRecord = await getMarketRecord(market.id)

  await check('L4a: immutable finalization unlocks creator liquidity and closes trader positions', async () => {
    assertApprox(firstFinalizePortfolio.stats.liquidityLocked, 0,
      'creator liquidityLocked should be zero after finalization', 0.001)
    assert(traderAfterFinalize.stats.totalPositions === 0,
      `trader positions should be closed, got ${traderAfterFinalize.stats.totalPositions}`)
    assert(!!marketRecord.settledAt, 'settledAt should be populated after finalization')
  })

  await check('L4b: repeated finalization trigger is idempotent', async () => {
    assertApprox(secondFinalizePortfolio.stats.liquidityLocked, 0,
      'liquidityLocked should stay zero on repeated trigger', 0.001)
    assertApprox(creatorBalanceAfterSecondFinalize, creatorBalanceAfterFirstFinalize,
      'creator balance should not change on second finalization trigger', 0.001)
  })

  await check('L4c: winning trader receives payout only after immutable finalization', async () => {
    const traderAfterBalance = await getBalance(trader.jar)
    const expected = traderBefore - buy.totalCost + 40
    assertApprox(traderAfterBalance, expected,
      'trader YES payout should be credited at finalization', 0.02)
    console.log(`    creator post-create=${creatorAfterCreate.toFixed(4)}, creator after finalize=${creatorBalanceAfterSecondFinalize.toFixed(4)}`)
  })
}

async function scenarioInvalidLifecycle() {
  heading('L5 — INVALID lifecycle refunds positions and unlocks creator liquidity')

  const creator = await registerUser('l5creator')
  const trader = await registerUser('l5trader')
  const market = await createMarket(creator.jar, {
    initialLiquidity: 80,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 7000).toISOString(),
  })

  const traderStart = await getBalance(trader.jar)
  const buy = await trade(trader.jar, market.id, 'YES', 'BUY', 20)

  await sleep(7600)
  await getMarket(market.id)

  const invalidRes = await resolveMarket(creator.jar, market.id, 'INVALID')
  const pendingDetail = await getMarket(market.id)
  const pendingBalance = await getBalance(trader.jar)

  await check('L5a: INVALID resolution is provisional first and pins the market status', async () => {
    assert(invalidRes.settlementPending === true, 'INVALID resolve should still be settlementPending')
    assert(pendingDetail.status === 'INVALID', `detail status should be INVALID, got ${pendingDetail.status}`)
    assertApprox(pendingDetail.probabilities.yes, 0.5,
      'INVALID market should display 0.5 yes probability', 0.0001)
    assertApprox(pendingDetail.probabilities.no, 0.5,
      'INVALID market should display 0.5 no probability', 0.0001)
  })

  await check('L5b: INVALID does not refund trader until immutable finalization', async () => {
    assertApprox(pendingBalance, traderStart - buy.totalCost,
      'trader balance should remain debited until finalization', 0.01)
  })

  await backdateResolutionTime(market.id, 2)
  const creatorPortfolioAfter = await getPortfolio(creator.jar)
  const traderPortfolioAfter = await getPortfolio(trader.jar)
  const traderBalanceAfter = await getBalance(trader.jar)

  await check('L5c: INVALID finalization refunds cost basis and closes positions', async () => {
    assertApprox(creatorPortfolioAfter.stats.liquidityLocked, 0,
      'creator liquidity should unlock after INVALID finalization', 0.001)
    assert(traderPortfolioAfter.stats.totalPositions === 0,
      'trader position should be closed after INVALID finalization')
    assertApprox(traderBalanceAfter, traderStart,
      'single BUY trader should get full cost-basis refund on INVALID', 0.02)
  })
}

async function scenarioDisputeAndReResolution() {
  heading('L6 — dispute lifecycle re-resolves market and finalizes latest outcome')

  const creator = await registerUser('l6creator')
  const yesTrader = await registerUser('l6yes')
  const noTrader = await registerUser('l6no')

  const market = await createMarket(creator.jar, {
    initialLiquidity: 100,
    disputeWindowHours: 720,
    endDate: new Date(Date.now() + 7000).toISOString(),
  })

  const yesTraderStart = await getBalance(yesTrader.jar)
  const noTraderStart = await getBalance(noTrader.jar)
  const yesBuy = await trade(yesTrader.jar, market.id, 'YES', 'BUY', 30)
  const noBuy = await trade(noTrader.jar, market.id, 'NO', 'BUY', 25)

  await sleep(7600)
  await getMarket(market.id)

  const initialVote = await voteMarket(creator.jar, market.id, 'YES')
  const afterInitial = await getMarket(market.id)

  await check('L6a: first vote on closed market provisionally resolves it immediately', async () => {
    assert(initialVote.autoResolved === true, 'first vote should auto-resolve round 0')
    assert(afterInitial.status === 'RESOLVED', `market should be RESOLVED, got ${afterInitial.status}`)
    assert(afterInitial.resolution === 'YES', `market should provisionally resolve YES, got ${afterInitial.resolution}`)
  })

  await disputeMarket(noTrader.jar, market.id, 'NO')
  const disputedDetail = await getMarket(market.id)

  await check('L6b: dispute moves market into DISPUTED status without paying out yet', async () => {
    assert(disputedDetail.status === 'DISPUTED', `market should be DISPUTED, got ${disputedDetail.status}`)
    assert(disputedDetail.disputes.length > 0, 'market should expose the new dispute in detail view')
    const yesBalance = await getBalance(yesTrader.jar)
    assertApprox(yesBalance, yesTraderStart - yesBuy.totalCost,
      'YES trader should not be paid out during dispute window', 0.02)
  })

  const firstReVote = await voteMarket(yesTrader.jar, market.id, 'NO')
  const midDetail = await getMarket(market.id)
  const secondReVote = await voteMarket(noTrader.jar, market.id, 'NO')
  const resolvedAgain = await getMarket(market.id)

  await check('L6c: dispute round requires quorum before re-resolution occurs', async () => {
    assert(firstReVote.autoResolved === false, 'first dispute-round vote should not resolve yet')
    assert(midDetail.status === 'DISPUTED', `market should remain DISPUTED after first re-vote, got ${midDetail.status}`)
    assert(secondReVote.autoResolved === true, 'second dispute-round vote should resolve the market')
    assert(secondReVote.majorityOutcome === 'NO', `majority outcome should be NO, got ${secondReVote.majorityOutcome}`)
    assert(resolvedAgain.status === 'RESOLVED', `market should return to RESOLVED, got ${resolvedAgain.status}`)
    assert(resolvedAgain.resolution === 'NO', `market should re-resolve to NO, got ${resolvedAgain.resolution}`)
  })

  await backdateResolutionTime(market.id, 721)
  await getPortfolio(creator.jar)
  const yesPortfolio = await getPortfolio(yesTrader.jar)
  const noPortfolio = await getPortfolio(noTrader.jar)
  const noBalanceAfter = await getBalance(noTrader.jar)

  await check('L6d: finalization settles the latest outcome only and closes both positions', async () => {
    assert(yesPortfolio.stats.totalPositions === 0, 'YES trader position should be closed after re-resolution finalize')
    assert(noPortfolio.stats.totalPositions === 0, 'NO trader position should be closed after re-resolution finalize')
    const expectedNoBalance = noTraderStart - noBuy.totalCost + 25
    assertApprox(noBalanceAfter, expectedNoBalance,
      'NO trader should receive payout from final NO resolution only', 0.02)
  })
}

async function scenarioShortLifecycle() {
  heading('L7 — short lifecycle keeps exposure pending, then settles definitively')

  const creator = await registerUser('l7creator')
  const shortWinner = await registerUser('l7shortwinner')
  const shortLoser = await registerUser('l7shortloser')

  const winningMarket = await createMarket(creator.jar, {
    initialLiquidity: 100,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 7000).toISOString(),
  })
  const losingMarket = await createMarket(creator.jar, {
    initialLiquidity: 100,
    disputeWindowHours: 1,
    endDate: new Date(Date.now() + 7000).toISOString(),
  })

  const winnerStart = await getBalance(shortWinner.jar)
  const loserStart = await getBalance(shortLoser.jar)
  const winnerShort = await trade(shortWinner.jar, winningMarket.id, 'NO', 'SELL', 4)
  const loserShort = await trade(shortLoser.jar, losingMarket.id, 'YES', 'SELL', 4)

  await sleep(7600)
  await getMarket(winningMarket.id)
  await getMarket(losingMarket.id)

  const winnerResolve = await resolveMarket(creator.jar, winningMarket.id, 'YES')
  const loserResolve = await resolveMarket(creator.jar, losingMarket.id, 'YES')

  const winnerPendingPortfolio = await getPortfolio(shortWinner.jar)
  const loserPendingPortfolio = await getPortfolio(shortLoser.jar)
  const winnerPendingBalance = await getBalance(shortWinner.jar)
  const loserPendingBalance = await getBalance(shortLoser.jar)

  await check('L7a: short resolutions are provisional first and do not settle immediately', async () => {
    assert(winnerResolve.settlementPending === true, 'winning short market should remain provisional first')
    assert(loserResolve.settlementPending === true, 'losing short market should remain provisional first')
    assert(winnerPendingPortfolio.stats.totalPositions > 0, 'winning short should remain open during dispute window')
    assert(loserPendingPortfolio.stats.totalPositions > 0, 'losing short should remain open during dispute window')
    assert(Number(winnerPendingPortfolio.stats.shortCollateral) > 0, 'winning short collateral should remain locked pre-finalization')
    assert(Number(loserPendingPortfolio.stats.shortCollateral) > 0, 'losing short collateral should remain locked pre-finalization')
    assertApprox(winnerPendingBalance, winnerStart - winnerShort.totalCost - 4,
      'winning short should remain at proceeds minus locked collateral before finalization', 0.02)
    assertApprox(loserPendingBalance, loserStart - loserShort.totalCost - 4,
      'losing short should remain at proceeds minus locked collateral before finalization', 0.02)
  })

  await backdateResolutionTime(winningMarket.id, 2)
  await backdateResolutionTime(losingMarket.id, 2)
  await getPortfolio(creator.jar)

  const winnerAfterPortfolio = await getPortfolio(shortWinner.jar)
  const loserAfterPortfolio = await getPortfolio(shortLoser.jar)
  const winnerAfterBalance = await getBalance(shortWinner.jar)
  const loserAfterBalance = await getBalance(shortLoser.jar)

  await check('L7b: finalization closes winning short and releases its collateral', async () => {
    assert(winnerAfterPortfolio.stats.totalPositions === 0, 'winning short should be closed after finalization')
    assertApprox(Number(winnerAfterPortfolio.stats.shortCollateral), 0,
      'winning short collateral should be released after finalization', 0.001)
    assertApprox(winnerAfterBalance, winnerStart - winnerShort.totalCost,
      'winning short should end with proceeds once collateral is released', 0.02)
  })

  await check('L7c: finalization closes losing short without extra payout', async () => {
    assert(loserAfterPortfolio.stats.totalPositions === 0, 'losing short should be closed after finalization')
    assertApprox(Number(loserAfterPortfolio.stats.shortCollateral), 0,
      'losing short collateral should be cleared after finalization', 0.001)
    assertApprox(loserAfterBalance, loserPendingBalance,
      'losing short collateral should be consumed by payout obligation', 0.02)
  })
}

async function main() {
  const mode = (process.argv[2] || 'all').toLowerCase()

  if (!['all', 'core', 'invalid', 'dispute'].includes(mode)) {
    console.error(`Unknown mode: ${mode}. Use all | core | invalid | dispute`)
    process.exit(1)
  }

  console.log('════════════════════════════════════════════════════════════════════════')
  console.log('  Market Lifecycle Simulation')
  console.log('════════════════════════════════════════════════════════════════════════')
  console.log(`  BASE_URL : ${BASE_URL}`)
  console.log(`  Mode     : ${mode}`)
  console.log(`  Run tag  : ${RUN}`)

  await waitForServer()

  if (mode === 'all' || mode === 'core') {
    await scenarioOpenAndExpiryLifecycle()
    await scenarioProvisionalAndFinalSettlement()
    await scenarioShortLifecycle()
  }
  if (mode === 'all' || mode === 'invalid') {
    await scenarioInvalidLifecycle()
  }
  if (mode === 'all' || mode === 'dispute') {
    await scenarioDisputeAndReResolution()
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