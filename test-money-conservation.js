#!/usr/bin/env node
/**
 * Money Conservation Simulation
 *
 * Verifies that every code path that touches balances does so precisely and
 * conservatively — no money is created or destroyed.
 *
 * This file is COMPLEMENTARY to test-money-flow-integrity.js.  That file
 * checks the lifecycle accounting identity after full settlement.  This file
 * checks the fine-grained sub-invariants at every mutation point:
 *
 *   PART A — API-only (no direct DB access, no settlement needed)
 *     1. AMM BUY:  balance decreases by exactly trade.totalCost
 *     2. AMM SELL: balance increases by exactly |trade.totalCost|
 *     3. Round-trip (buy-then-sell same shares): net balance residual ≤ $0.01
 *     4. Multi-user sum: Σ(balance_decrease_i) = Σ(reported_totalCost_i)
 *     5. Exchange BID reservation: balance decreases by exactly price × shares
 *     6. Exchange BID cancel — full exact refund
 *     7. Exchange BID/ASK fill — buyer pays X, seller receives X (net $0) for long inventory
 *     8. Exchange naked short ASK fill — buyer pays X, seller available stays flat, reserve increases by X
 *
 *   PART B — Full lifecycle (uses Prisma to backdate dispute window)
 *     8.  Zero-trade market — creator gets full liquidity back
 *     9.  Single-sided market — only YES buyers, resolves YES
 *    10.  Creator as active trader — creator wins + gets residual refund
 *    11.  Dispute rollback — sum conserved at: pre-resolve, resolve, dispute, re-resolve
 *    12.  Precision drift under 20 micro-trades — accumulated error ≤ 0.02
 *
 * Run:
 *   node test-money-conservation.js          # all parts
 *   node test-money-conservation.js api      # part A only (fast, no DB)
 *   node test-money-conservation.js lifecycle # part B only
 *
 * Requires:
 *   DATABASE_URL env var for part B (Prisma direct access for dispute-window bypass)
 *   Dev server running at BASE_URL (default http://localhost:3001)
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN = Date.now().toString(36)
let userSeq = 0

// ─── Prisma (only instantiated for lifecycle scenarios) ───────────────────

let prisma = null
function getPrisma() {
  if (!prisma) {
    const { PrismaClient } = require('@prisma/client')
    const { PrismaPg } = require('@prisma/adapter-pg')
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    prisma = new PrismaClient({ adapter })
  }
  return prisma
}

// ─── HTTP utilities ───────────────────────────────────────────────────────

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

async function req(method, path, body = null, jar = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (jar) headers.Cookie = jar.getCookieHeader()
  const opts = { method, headers }
  if (body !== null) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE_URL}${path}`, opts)
  const setCookies = res.headers.getSetCookie?.() || []
  if (jar && setCookies.length) jar.setCookies(setCookies)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, ok: res.ok, data }
}

// ─── Assertion helpers ────────────────────────────────────────────────────

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

// ─── Test runner ──────────────────────────────────────────────────────────

let passCount = 0
let failCount = 0
const failures = []

function pass(label) { passCount++; console.log(`  ✅ ${label}`) }
function fail(label, err) {
  failCount++
  failures.push({ label, err: err?.message || String(err) })
  console.error(`  ❌ ${label}: ${err?.message || err}`)
}

async function check(label, fn) {
  try { await fn(); pass(label) } catch (e) { fail(label, e) }
}

function section(name) {
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  ${name}`)
  console.log('═'.repeat(72))
}

function scenario(name) {
  console.log(`\n  ${'─'.repeat(68)}`)
  console.log(`  Scenario: ${name}`)
  console.log(`  ${'─'.repeat(68)}`)
}

// ─── Fixture helpers ──────────────────────────────────────────────────────

async function registerUser(role) {
  const jar = new CookieJar()
  const id = `${RUN}_${++userSeq}`
  const r = await req('POST', '/api/auth/register', {
    email: `${role}_${id}@conservation.test`,
    username: `${role}_${id}`,
    password: 'Password1!',
  }, jar)
  assert(r.ok, `register ${role} failed: ${JSON.stringify(r.data)}`)
  return { jar, user: r.data.user }
}

async function getBalance(jar) {
  const r = await req('GET', '/api/auth/me', null, jar)
  assert(r.ok, `getBalance failed: ${JSON.stringify(r.data)}`)
  return Number(r.data.balance)
}

async function getPortfolio(jar) {
  const r = await req('GET', '/api/portfolio', null, jar)
  assert(r.ok, `getPortfolio failed: ${JSON.stringify(r.data)}`)
  return r.data
}

async function createMarket(jar, opts = {}) {
  const r = await req('POST', '/api/markets', {
    title: `Conservation Market ${RUN}_${++userSeq} — test title`,
    description: 'Automated money-conservation integrity check market for lifecycle testing.',
    category: 'Test',
    endDate: opts.endDate ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    resolutionSource: 'https://example.com/resolution',
    initialLiquidity: opts.initialLiquidity ?? 100,
    priorProbability: opts.priorProbability ?? 0.5,
    disputeWindowHours: opts.disputeWindowHours ?? 1,
  }, jar)
  assert(r.ok, `createMarket failed: ${JSON.stringify(r.data)}`)
  return r.data.market
}

async function ammTrade(jar, marketId, outcome, type, shares) {
  const r = await req('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(r.ok, `trade ${type} ${outcome}×${shares} failed: ${JSON.stringify(r.data)}`)
  return r.data.trade
}

async function placeOrder(jar, marketId, opts) {
  const r = await req('POST', `/api/markets/${marketId}/order`, opts, jar)
  assert(r.ok, `placeOrder failed: ${JSON.stringify(r.data)}`)
  return r.data
}

async function cancelOrder(jar, marketId, orderId) {
  const r = await req('DELETE', `/api/markets/${marketId}/order`, { orderId }, jar)
  assert(r.ok, `cancelOrder ${orderId} failed: ${JSON.stringify(r.data)}`)
  return r.data
}

async function resolveMarket(jar, marketId, outcome) {
  const r = await req('POST', `/api/markets/${marketId}/resolve`, { outcome }, jar)
  assert(r.ok, `resolve ${outcome} failed: ${JSON.stringify(r.data)}`)
  return r.data
}

async function voteMarket(jar, marketId, outcome) {
  const r = await req('POST', `/api/markets/${marketId}/vote`, { outcome }, jar)
  assert(r.ok, `vote ${outcome} failed: ${JSON.stringify(r.data)}`)
  return r.data
}

async function disputeMarket(jar, marketId, reason, proposedOutcome) {
  const r = await req('POST', `/api/markets/${marketId}/dispute`, { reason, proposedOutcome }, jar)
  assert(r.ok, `dispute failed: ${JSON.stringify(r.data)}`)
  return r.data
}

/**
 * Bypass the dispute window by backdating resolutionTime in the DB,
 * then trigger the lazy finalization via a portfolio fetch.
 */
async function forceSettlement(marketId, triggerJar, backdateHours = 2) {
  const db = getPrisma()
  await db.market.update({
    where: { id: marketId },
    data: { resolutionTime: new Date(Date.now() - backdateHours * 60 * 60 * 1000) },
  })
  await new Promise(r => setTimeout(r, 100))
  const r = await req('GET', '/api/portfolio', null, triggerJar)
  assert(r.ok, `portfolio trigger failed: ${JSON.stringify(r.data)}`)
  await new Promise(r => setTimeout(r, 200))
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE_URL}/api/markets`)
      if (r.status < 500) return
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Server did not respond within 20 s')
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART A — API-ONLY INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

async function partA_ammBuyCostMatchesBalanceDecrease() {
  scenario('A1 — AMM BUY: balance decreases by exactly trade.totalCost')

  const { jar } = await registerUser('a1')
  const market = await createMarket(jar)

  const before = await getBalance(jar)
  const trade = await ammTrade(jar, market.id, 'YES', 'BUY', 20)
  const after = await getBalance(jar)

  await check('A1a: trade API reports positive totalCost', async () => {
    assert(trade.totalCost > 0, `totalCost should be positive, got ${trade.totalCost}`)
    console.log(`    YES BUY 20 shares: totalCost=${trade.totalCost.toFixed(6)}`)
  })

  await check('A1b: balance decrease = reported totalCost (exact to $0.001)', async () => {
    const decrease = before - after
    assertApprox(decrease, trade.totalCost,
      `balance decrease (${decrease.toFixed(6)}) should equal totalCost (${trade.totalCost.toFixed(6)})`, 0.001)
  })

  // Second BUY on same market to verify same property holds post-price-move
  const before2 = await getBalance(jar)
  const trade2 = await ammTrade(jar, market.id, 'NO', 'BUY', 10)
  const after2 = await getBalance(jar)

  await check('A1c: subsequent BUY (different outcome) satisfies same invariant', async () => {
    const decrease2 = before2 - after2
    assertApprox(decrease2, trade2.totalCost,
      `subsequent BUY balance decrease matches totalCost`, 0.001)
  })
}

async function partA_ammSellProceedsMatchesBalanceIncrease() {
  scenario('A2 — AMM SELL: balance increases by exactly |trade.totalCost|')

  const { jar } = await registerUser('a2')
  const market = await createMarket(jar)

  // Buy first so there are shares to sell
  await ammTrade(jar, market.id, 'YES', 'BUY', 30)

  const before = await getBalance(jar)
  const trade = await ammTrade(jar, market.id, 'YES', 'SELL', 15)
  const after = await getBalance(jar)

  await check('A2a: SELL trade reports negative totalCost (proceeds returned)', async () => {
    assert(trade.totalCost < 0, `SELL totalCost should be negative (proceeds), got ${trade.totalCost}`)
    console.log(`    YES SELL 15 shares: totalCost=${trade.totalCost.toFixed(6)} (proceeds=${Math.abs(trade.totalCost).toFixed(6)})`)
  })

  await check('A2b: balance increase = |SELL totalCost| (exact to $0.001)', async () => {
    const increase = after - before
    const proceeds = Math.abs(trade.totalCost)
    assertApprox(increase, proceeds,
      `balance increase (${increase.toFixed(6)}) should equal proceeds (${proceeds.toFixed(6)})`, 0.001)
  })
}

async function partA_roundTripResidual() {
  scenario('A3 — Round-trip BUY→SELL same shares: net residual ≤ $0.01')

  const { jar } = await registerUser('a3')
  const market = await createMarket(jar)
  const before = await getBalance(jar)

  const buy = await ammTrade(jar, market.id, 'YES', 'BUY', 25)
  const sell = await ammTrade(jar, market.id, 'YES', 'SELL', 25)
  const after = await getBalance(jar)

  const netCost = buy.totalCost + sell.totalCost       // sell.totalCost is negative
  const balanceChange = before - after

  await check('A3a: reported costs sum to near zero (LMSR path-consistency)', async () => {
    assertApprox(netCost, 0, `round-trip reported net cost should be near $0`, 0.01)
    console.log(`    BUY totalCost=${buy.totalCost.toFixed(6)}, SELL totalCost=${sell.totalCost.toFixed(6)}, net=${netCost.toFixed(6)}`)
  })

  await check('A3b: actual balance change matches reported net cost', async () => {
    assertApprox(balanceChange, netCost,
      `balance change (${balanceChange.toFixed(6)}) should equal reported net cost (${netCost.toFixed(6)})`, 0.001)
  })

  // A larger round-trip at different size
  const before2 = await getBalance(jar)
  const buy2  = await ammTrade(jar, market.id, 'YES', 'BUY', 50)
  const sell2 = await ammTrade(jar, market.id, 'YES', 'SELL', 50)
  const after2 = await getBalance(jar)

  await check('A3c: larger round-trip (50 shares) also has residual ≤ $0.01', async () => {
    const netCost2 = buy2.totalCost + sell2.totalCost
    assertApprox(netCost2, 0, `larger round-trip net cost should be near $0`, 0.01)
    assertApprox(before2 - after2, netCost2,
      `balance change matches reported net cost for larger round-trip`, 0.001)
    console.log(`    50-share round-trip residual: ${netCost2.toFixed(6)}`)
  })
}

async function partA_multiUserSumInvariant() {
  scenario('A4 — Multi-user AMM: Σ(balance decreases) = Σ(reported totalCosts)')

  const users = await Promise.all([
    registerUser('a4u1'),
    registerUser('a4u2'),
    registerUser('a4u3'),
  ])
  const market = await createMarket(users[0].jar)

  const before = await Promise.all(users.map(u => getBalance(u.jar)))

  // Three users each buy different amounts and outcomes
  const t1 = await ammTrade(users[0].jar, market.id, 'YES', 'BUY', 20)
  const t2 = await ammTrade(users[1].jar, market.id, 'NO',  'BUY', 15)
  const t3 = await ammTrade(users[2].jar, market.id, 'YES', 'BUY', 30)

  const after = await Promise.all(users.map(u => getBalance(u.jar)))

  await check('A4a: each user balance decreased by their own reported cost', async () => {
    for (let i = 0; i < users.length; i++) {
      const decrease = before[i] - after[i]
      const cost = [t1, t2, t3][i].totalCost
      assertApprox(decrease, cost,
        `user ${i + 1}: balance decrease (${decrease.toFixed(6)}) = totalCost (${cost.toFixed(6)})`, 0.001)
    }
  })

  await check('A4b: total balance decrease across all users equals sum of reported costs', async () => {
    const totalDecrease = before.reduce((s, b, i) => s + (b - after[i]), 0)
    const totalCost     = t1.totalCost + t2.totalCost + t3.totalCost
    assertApprox(totalDecrease, totalCost,
      `Σ(balance decreases)=${totalDecrease.toFixed(6)} should equal Σ(totalCosts)=${totalCost.toFixed(6)}`, 0.002)
    console.log(`    Σ costs: ${totalCost.toFixed(6)}, Σ balance drops: ${totalDecrease.toFixed(6)}`)
  })
}

async function partA_exchangeBidReservation() {
  scenario('A5 — Exchange BID: balance decreases by exactly price × shares at order placement')

  const { jar } = await registerUser('a5')
  const market = await createMarket(jar)

  const price  = 0.45
  const shares = 20
  const expectedReserve = price * shares

  const before = await getBalance(jar)
  const result = await placeOrder(jar, market.id, {
    outcome: 'YES', side: 'BID', orderType: 'GTC', price, shares,
  })
  const after = await getBalance(jar)

  await check('A5a: balance decreases on BID placement', async () => {
    const decrease = before - after
    assertApprox(decrease, expectedReserve,
      `BID reserve decrease (${decrease.toFixed(6)}) should equal price×shares (${expectedReserve.toFixed(6)})`, 0.001)
    console.log(`    BID ${price}×${shares}: expected reserve=${expectedReserve.toFixed(6)}, actual decrease=${decrease.toFixed(6)}`)
  })

  await check('A5b: order response confirms correct price and remainingShares', async () => {
    const order = result.order
    assert(order, 'order field missing from response')
    assertApprox(Number(order.price), price, `order.price should be ${price}`, 0.0001)
    // The DB stores initialShares and remainingShares; at placement time they are equal.
    assert(Number(order.remainingShares) === shares, `order.remainingShares should be ${shares}, got ${order.remainingShares}`)
  })
}

async function partA_exchangeCancelFullRefund() {
  scenario('A6 — Exchange cancel: full exact refund of reserved amount')

  const { jar } = await registerUser('a6')
  const market = await createMarket(jar)

  // First, give this user a baseline balance reading after the market creation cost
  const balanceAtStart = await getBalance(jar)

  const price = 0.40, shares = 15
  const expectedReserve = price * shares

  const order_r = await placeOrder(jar, market.id, {
    outcome: 'YES', side: 'BID', orderType: 'GTC', price, shares,
  })
  const orderId = order_r.order.id

  const afterPlace = await getBalance(jar)

  await check('A6a: BID placement reserves correct amount', async () => {
    const reserved = balanceAtStart - afterPlace
    assertApprox(reserved, expectedReserve,
      `reserved=${reserved.toFixed(6)} should equal price×shares=${expectedReserve.toFixed(6)}`, 0.001)
  })

  await cancelOrder(jar, market.id, orderId)
  const afterCancel = await getBalance(jar)

  await check('A6b: cancel restores balance exactly to pre-order level', async () => {
    assertApprox(afterCancel, balanceAtStart,
      `balance after cancel (${afterCancel.toFixed(6)}) should equal pre-order balance (${balanceAtStart.toFixed(6)})`, 0.001)
    console.log(`    pre-order=${balanceAtStart.toFixed(6)}, after-place=${afterPlace.toFixed(6)}, after-cancel=${afterCancel.toFixed(6)}`)
  })

  // Cancel of second order (larger) to confirm the refund amount scales correctly
  const price2 = 0.60, shares2 = 10
  const balanceBefore2 = await getBalance(jar)
  const order2_r = await placeOrder(jar, market.id, {
    outcome: 'YES', side: 'BID', orderType: 'GTC', price: price2, shares: shares2,
  })
  await cancelOrder(jar, market.id, order2_r.order.id)
  const balanceAfter2 = await getBalance(jar)

  await check('A6c: second cancel also fully restores balance', async () => {
    assertApprox(balanceBefore2, balanceAfter2,
      `balance fully restored after second cancel`, 0.001)
  })
}

async function partA_exchangeFillZeroSum() {
  scenario('A7 — Exchange fill: buyer pays X, seller receives X — net balance change = $0')

  const buyer  = await registerUser('a7buyer')
  const seller = await registerUser('a7seller')
  const market = await createMarket(buyer.jar)

  // Seller acquires YES shares via AMM so they can list an ASK
  const ammBuy = await ammTrade(seller.jar, market.id, 'YES', 'BUY', 30)
  console.log(`    Seller AMM BUY 30 YES: cost=${ammBuy.totalCost.toFixed(6)}`)

  const sellerAfterAmm = await getBalance(seller.jar)
  const buyerBeforeBid = await getBalance(buyer.jar)
  const sumBefore       = sellerAfterAmm + buyerBeforeBid

  // Buyer places BID at 0.55 for 10 shares
  const price = 0.55, shares = 10
  const bidReserve = price * shares

  await placeOrder(buyer.jar, market.id, {
    outcome: 'YES', side: 'BID', orderType: 'GTC', price, shares,
  })
  const buyerAfterBid = await getBalance(buyer.jar)

  await check('A7a: buyer balance decreases by price×shares at BID time', async () => {
    const reserve = buyerBeforeBid - buyerAfterBid
    assertApprox(reserve, bidReserve,
      `BID reservation (${reserve.toFixed(6)}) = price×shares (${bidReserve.toFixed(6)})`, 0.001)
  })

  // Seller places matching ASK — should fill immediately
  const askResult = await placeOrder(seller.jar, market.id, {
    outcome: 'YES', side: 'ASK', orderType: 'GTC', price, shares,
  })
  const filledShares = askResult.filledShares || 0

  await check('A7b: ask fills at least partially against the open bid', async () => {
    assert(filledShares > 0, `expected fill, got filledShares=${filledShares}`)
    console.log(`    filledShares=${filledShares}, fillPrice=${price}`)
  })

  const buyerAfterFill  = await getBalance(buyer.jar)
  const sellerAfterFill = await getBalance(seller.jar)
  const sumAfter = buyerAfterFill + sellerAfterFill

  await check('A7c: combined buyer+seller balance unchanged by the fill itself', async () => {
    // The only change to sum should be the BID reservation — but after fill that
    // reservation has transferred to the seller, so sum should equal sumBefore.
    assertApprox(sumAfter, sumBefore,
      `combined balance after fill (${sumAfter.toFixed(6)}) should equal combined balance before bid (${sumBefore.toFixed(6)})`, 0.01)
    console.log(`    sumBefore=${sumBefore.toFixed(6)}, sumAfter=${sumAfter.toFixed(6)}, diff=${Math.abs(sumAfter - sumBefore).toFixed(6)}`)
  })

  await check('A7d: seller received exactly price×filledShares', async () => {
    const sellerIncrease = sellerAfterFill - sellerAfterAmm
    const expectedIncrease = price * filledShares
    assertApprox(sellerIncrease, expectedIncrease,
      `seller balance increase (${sellerIncrease.toFixed(6)}) should equal price×filledShares (${expectedIncrease.toFixed(6)})`, 0.01)
  })
}

async function partA_exchangeNakedShortAskReserveFlow() {
  scenario('A8 — Exchange naked short ASK: buyer payment goes into reserve, not seller available balance')

  const buyer = await registerUser('a8buyer')
  const seller = await registerUser('a8seller')
  const market = await createMarket(buyer.jar)

  const price = 0.4
  const shares = 10
  const initialReserve = shares * (1 - price)

  const sellerBeforeAsk = await getBalance(seller.jar)
  const ask = await placeOrder(seller.jar, market.id, {
    outcome: 'YES', side: 'ASK', orderType: 'GTC', price, shares,
  })
  const sellerAfterAsk = await getBalance(seller.jar)

  await check('A8a: naked ASK placement locks initial reserve of shares×(1-price)', async () => {
    assertApprox(sellerBeforeAsk - sellerAfterAsk, initialReserve,
      'naked ASK should lock initial reserve', 0.001)
    const portfolioAfterAsk = await getPortfolio(seller.jar)
    assertApprox(Number(portfolioAfterAsk.stats.reservedBalance), initialReserve,
      'portfolio reserved balance should reflect initial naked-ask reserve', 0.001)
  })

  const buyerBeforeBid = await getBalance(buyer.jar)
  await placeOrder(buyer.jar, market.id, {
    outcome: 'YES', side: 'BID', orderType: 'GTC', price, shares: 5,
  })
  const buyerAfterBid = await getBalance(buyer.jar)
  const sellerAfterFill = await getBalance(seller.jar)

  await check('A8b: buyer pays fill notional while seller available balance stays flat', async () => {
    assertApprox(buyerBeforeBid - buyerAfterBid, 2,
      'buyer available balance should decrease by fill notional', 0.001)
    assertApprox(sellerAfterFill, sellerAfterAsk,
      'seller available balance should not receive or lose cash on naked short fill', 0.001)
  })

  await check('A8c: remaining order reserve grows to reflect total locked collateral', async () => {
    const portfolio = await getPortfolio(seller.jar)
    assertApprox(Number(portfolio.stats.reservedBalance), 8,
      'after 5-share fill, locked reserve should be 8', 0.001)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART B — FULL LIFECYCLE INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

async function partB_zeroTradeMarket() {
  scenario('B8 — Zero-trade market: creator recovers full initialLiquidity')

  const initialLiquidity = 200
  const creator = await registerUser('b8creator')
  const startBalance = await getBalance(creator.jar)

  const market = await createMarket(creator.jar, { initialLiquidity })

  await check('B8a: creator balance decreases by initialLiquidity after create', async () => {
    const after = await getBalance(creator.jar)
    assertApprox(after, startBalance - initialLiquidity,
      `balance after create should be start - initialLiquidity`, 0.001)
  })

  // Resolve with no trades
  await resolveMarket(creator.jar, market.id, 'YES')
  await forceSettlement(market.id, creator.jar)

  const endBalance = await getBalance(creator.jar)

  await check('B8b: creator fully recovers initialLiquidity after zero-trade settlement', async () => {
    assertApprox(endBalance, startBalance,
      `creator end balance (${endBalance.toFixed(6)}) should restore to start (${startBalance.toFixed(6)})`, 0.01)
    console.log(`    start=${startBalance.toFixed(4)}, end=${endBalance.toFixed(4)}, diff=${Math.abs(endBalance - startBalance).toFixed(6)}`)
  })

  await check('B8c: INVALID resolution on zero-trade market also conserves', async () => {
    // start2 is captured AFTER createMarket, so it equals 1000 - 150 = 850.
    // After INVALID settlement with no trades: totalPayout=0, creatorRefund=150.
    // end2 = 850 + 150 = start2 + initialLiquidity.
    const creator2 = await registerUser('b8creator2')
    const m2 = await createMarket(creator2.jar, { initialLiquidity: 150 })
    const start2 = await getBalance(creator2.jar)  // post-create balance = 1000 - 150 = 850
    await resolveMarket(creator2.jar, m2.id, 'INVALID')
    await forceSettlement(m2.id, creator2.jar)
    const end2 = await getBalance(creator2.jar)
    assertApprox(end2, start2 + 150,
      `INVALID zero-trade: creator end balance (${end2.toFixed(6)}) should equal post-create balance + initialLiquidity (${(start2 + 150).toFixed(6)})`, 0.01)
    console.log(`    INVALID: post-create=${start2.toFixed(4)}, after-settle=${end2.toFixed(4)}, recovered=${(end2 - start2).toFixed(4)}`)
  })
}

async function partB_singleSidedMarket() {
  scenario('B9 — Single-sided YES market: only YES buyers, resolves YES — conservation holds')

  const creator = await registerUser('b9creator')
  const alice   = await registerUser('b9alice')
  const bob     = await registerUser('b9bob')

  // Capture startSum BEFORE createMarket so the locked liquidity is included.
  const startSum = (await Promise.all([creator, alice, bob].map(u => getBalance(u.jar)))).reduce((a, b) => a + b, 0)

  const initialLiquidity = 100
  const market = await createMarket(creator.jar, { initialLiquidity })

  // Only YES buyers — NO side left untouched (creator's liquidity subsidizes if YES wins)
  const t1 = await ammTrade(alice.jar, market.id, 'YES', 'BUY', 30)
  const t2 = await ammTrade(bob.jar,   market.id, 'YES', 'BUY', 20)

  await check('B9a: probability shifted toward YES after single-sided buying', async () => {
    const r = await req('GET', `/api/markets/${market.id}/probability`)
    assert(r.ok, 'probability fetch failed')
    assert(r.data.yes > 0.5, `YES prob should be > 0.5, got ${r.data.yes}`)
    console.log(`    YES prob after 50 YES buys: ${r.data.yes.toFixed(4)}`)
  })

  await resolveMarket(creator.jar, market.id, 'YES')
  await forceSettlement(market.id, creator.jar)

  const endBalances = await Promise.all([creator, alice, bob].map(u => getBalance(u.jar)))
  const endSum = endBalances.reduce((a, b) => a + b, 0)

  await check('B9b: alice receives 30 YES-share payout', async () => {
    const aliceStart = startSum / 3  // each started at 1000
    const aliceNet = t1.totalCost    // what alice paid
    const expected = 1000 - aliceNet + 30
    assertApprox(endBalances[1], expected,
      `alice end balance (${endBalances[1].toFixed(6)}) should equal 1000 - cost + 30`, 0.01)
  })

  await check('B9c: bob receives 20 YES-share payout', async () => {
    const expected = 1000 - t2.totalCost + 20
    assertApprox(endBalances[2], expected,
      `bob end balance (${endBalances[2].toFixed(6)}) should equal 1000 - cost + 20`, 0.01)
  })

  await check('B9d: sum of all balances conserved (tolerance $0.02)', async () => {
    assertApprox(endSum, startSum,
      `total balance sum should be conserved: start=${startSum.toFixed(4)}, end=${endSum.toFixed(4)}`, 0.02)
    console.log(`    sum: start=${startSum.toFixed(4)}, end=${endSum.toFixed(4)}, diff=${Math.abs(endSum - startSum).toFixed(6)}`)
  })

  await check('B9e: accounting identity holds', async () => {
    const netTradeCost = t1.totalCost + t2.totalCost
    const creatorRefund = endBalances[0] - (1000 - initialLiquidity)
    const totalPayout = 30 + 20
    const lhs = initialLiquidity + netTradeCost
    const rhs = totalPayout + creatorRefund
    console.log(`    LHS=${lhs.toFixed(6)}, RHS=${rhs.toFixed(6)}, diff=${Math.abs(lhs - rhs).toFixed(6)}`)
    assertApprox(lhs, rhs,
      `initialLiquidity + netTradeCost (${lhs.toFixed(6)}) should equal totalPayout + creatorRefund (${rhs.toFixed(6)})`, 0.02)
  })
}

async function partB_creatorAsActiveTrader() {
  scenario('B10 — Creator as active trader: creator wins payout AND gets residual refund')

  const initialLiquidity = 100
  const creator = await registerUser('b10creator')
  const alice   = await registerUser('b10alice')

  const startCreator = await getBalance(creator.jar)
  const startAlice   = await getBalance(alice.jar)

  const market = await createMarket(creator.jar, { initialLiquidity })

  // Creator buys YES (creator is also a trader)
  const t_creator = await ammTrade(creator.jar, market.id, 'YES', 'BUY', 25)
  // Alice buys NO (she will lose)
  const t_alice   = await ammTrade(alice.jar,   market.id, 'NO',  'BUY', 20)

  await check('B10a: creator balance reflects both liquidity lock AND trade cost', async () => {
    const expectedCreator = startCreator - initialLiquidity - t_creator.totalCost
    const actualCreator = await getBalance(creator.jar)
    assertApprox(actualCreator, expectedCreator,
      `creator balance should be start - liquidity - tradeCost`, 0.001)
    console.log(`    expected=${expectedCreator.toFixed(4)}, actual=${actualCreator.toFixed(4)}`)
  })

  await resolveMarket(creator.jar, market.id, 'YES')
  await forceSettlement(market.id, creator.jar)

  const endCreator = await getBalance(creator.jar)
  const endAlice   = await getBalance(alice.jar)

  await check('B10b: creator receives YES winner payout of 25', async () => {
    // creator end = start - liquidity - t_creator.cost + 25 (YES payout) + creatorRefund
    // The assertion is easier via accounting identity below
    assert(endCreator > startCreator - initialLiquidity,
      `creator should have recovered more than just their liquidity lockup`)
  })

  await check('B10c: alice (NO loser) gets nothing from settlement', async () => {
    const expected = startAlice - t_alice.totalCost
    assertApprox(endAlice, expected,
      `alice (loser) end balance (${endAlice.toFixed(6)}) = start - tradeCost (${expected.toFixed(6)})`, 0.01)
  })

  await check('B10d: system sum conserved', async () => {
    const startSum = startCreator + startAlice
    const endSum   = endCreator   + endAlice
    assertApprox(endSum, startSum,
      `total balance conserved: start=${startSum.toFixed(4)}, end=${endSum.toFixed(4)}`, 0.02)
    console.log(`    diff=${Math.abs(endSum - startSum).toFixed(6)}`)
  })

  await check('B10e: accounting identity with creator as trader', async () => {
    const netTradeCost = t_creator.totalCost + t_alice.totalCost
    // creator refund portion = what came back beyond their starting-minus-liquidity
    const creatorRefund = endCreator - (startCreator - initialLiquidity - t_creator.totalCost + 25)
    const totalPayout = 25   // only creator's YES shares win
    const lhs = initialLiquidity + netTradeCost
    const rhs = totalPayout + (totalPayout + (initialLiquidity + netTradeCost - totalPayout))
    // Simpler: just check lhs ≈  totalPayout + actual_creator_residual
    const actualCreatorResidual = endCreator - (startCreator - initialLiquidity - t_creator.totalCost + 25)
    const rhsActual = totalPayout + actualCreatorResidual
    console.log(`    LHS=${lhs.toFixed(6)}, RHS(actual)=${rhsActual.toFixed(6)}`)
    assertApprox(lhs, rhsActual,
      `accounting identity: initialLiquidity + netTradeCost = totalPayout + creatorResidual`, 0.02)
  })
}

async function partB_disputeRollbackConservation() {
  scenario('B11 — Dispute rollback: system sum conserved at every phase of the lifecycle')

  const initialLiquidity = 100
  const creator = await registerUser('b11creator')
  const alice   = await registerUser('b11alice')   // YES trader (will win first, lose after re-resolve)
  const bob     = await registerUser('b11bob')     // NO trader (will lose first, win after re-resolve)

  // Short expiry so we can vote after it ends. disputeWindowHours large so dispute is always in-window.
  const market = await createMarket(creator.jar, {
    initialLiquidity,
    disputeWindowHours: 720,
    endDate: new Date(Date.now() + 5000).toISOString(),
  })

  // Capture startSum BEFORE createMarket locked the liquidity.
  const startBalances = {
    creator: await getBalance(creator.jar),  // already post-create here (liquidity locked)
    alice:   await getBalance(alice.jar),
    bob:     await getBalance(bob.jar),
  }
  // For true conservation we need to include the pool, so startSum uses pre-create balances.
  // Since createMarket call is above, we add initialLiquidity back artificially:
  const startSum = startBalances.creator + initialLiquidity + startBalances.alice + startBalances.bob
  console.log(`    Start sum (incl. market pool): $${startSum.toFixed(4)}`)

  // ── Phase 1: trading (before market expires) ─────────────────────────────
  const t_alice = await ammTrade(alice.jar, market.id, 'YES', 'BUY', 30)
  const t_bob   = await ammTrade(bob.jar,   market.id, 'NO',  'BUY', 25)

  const sumAfterTrades = startBalances.creator + startBalances.alice - t_alice.totalCost +
    startBalances.bob - t_bob.totalCost
  console.log(`    After trades sum (excl. pool): $${sumAfterTrades.toFixed(4)}`)

  // Wait for market to expire, then trigger close.
  await new Promise(r => setTimeout(r, 6000))
  await req('GET', '/api/markets')

  // ── Phase 2: initial YES resolution (vote) ───────────────────────────────
  await voteMarket(creator.jar, market.id, 'YES')  // first vote on disputeCount=0 → resolves immediately

  // NOTE: settlement is still PENDING at this point — the dispute window (720h) has not expired.
  // We do NOT call forceSettlement here; instead the dispute will re-steer the outcome.

  const sumAfterYesVote = (await Promise.all(
    [creator, alice, bob].map(u => getBalance(u.jar))
  )).reduce((a, b) => a + b, 0)

  await check('B11a: sum unchanged after YES vote (settlement still pending in dispute window)', async () => {
    // Sum should equal post-trade sum (market pool still holds funds).
    assertApprox(sumAfterYesVote, sumAfterTrades,
      `sum after YES vote (${sumAfterYesVote.toFixed(4)}) should equal post-trade sum (${sumAfterTrades.toFixed(4)})`, 0.02)
    console.log(`    After YES vote (pending): $${sumAfterYesVote.toFixed(4)}`)
  })

  const aliceAfterYesVote = await getBalance(alice.jar)
  await check('B11b: alice balance unchanged (no payout yet while settlement pending)', async () => {
    const expected = startBalances.alice - t_alice.totalCost
    assertApprox(aliceAfterYesVote, expected,
      `alice balance (${aliceAfterYesVote.toFixed(4)}) should be start - tradeCost (${expected.toFixed(4)})`, 0.01)
  })

  // ── Phase 3: Bob files dispute, market becomes DISPUTED ──────────────────
  await disputeMarket(bob.jar, market.id,
    'The resolution is incorrect. It should resolve NO based on the reference source.',
    'NO'
  )

  const sumAfterDispute = (await Promise.all(
    [creator, alice, bob].map(u => getBalance(u.jar))
  )).reduce((a, b) => a + b, 0)

  await check('B11c: system sum after dispute still equals post-trade sum (settlement still pending)', async () => {
    assertApprox(sumAfterDispute, sumAfterTrades,
      `sum after dispute (${sumAfterDispute.toFixed(4)}) should equal post-trade sum (${sumAfterTrades.toFixed(4)})`, 0.02)
    console.log(`    After dispute: $${sumAfterDispute.toFixed(4)}`)
  })

  // ── Phase 4: Re-vote NO with two votes (dispute round 1 requires quorum 2) ──
  await voteMarket(alice.jar, market.id, 'NO')  // vote 1
  await voteMarket(bob.jar,   market.id, 'NO')  // vote 2 → resolves as NO

  // Backdate by 721h to expire the 720h dispute window, then trigger settlement.
  await forceSettlement(market.id, creator.jar, 721)

  const endBalances = {
    creator: await getBalance(creator.jar),
    alice:   await getBalance(alice.jar),
    bob:     await getBalance(bob.jar),
  }
  const endSum = Object.values(endBalances).reduce((a, b) => a + b, 0)

  await check('B11d: system sum after final NO settlement equals starting sum (incl. market pool)', async () => {
    assertApprox(endSum, startSum,
      `sum after NO settlement (${endSum.toFixed(4)}) should equal start (${startSum.toFixed(4)})`, 0.02)
    console.log(`    After NO settle: $${endSum.toFixed(4)}, start: $${startSum.toFixed(4)}, diff: $${Math.abs(endSum - startSum).toFixed(6)}`)
  })

  await check('B11e: bob (NO winner) received 25 shares × $1', async () => {
    const expected = startBalances.bob - t_bob.totalCost + 25
    assertApprox(endBalances.bob, expected,
      `bob NO payout: expected ${expected.toFixed(4)}, got ${endBalances.bob.toFixed(4)}`, 0.02)
  })

  await check('B11f: alice (YES position, resolved NO) received nothing from settlement', async () => {
    const expected = startBalances.alice - t_alice.totalCost
    assertApprox(endBalances.alice, expected,
      `alice (loser on NO resolve): expected ${expected.toFixed(4)}, got ${endBalances.alice.toFixed(4)}`, 0.02)
  })
}

async function partB_precisionDriftUnderManyTrades() {
  scenario('B12 — Precision drift: 20 micro-trades, accumulated error ≤ $0.02')

  const { jar: traderJar } = await registerUser('b12trader')
  const { jar: creatorJar } = await registerUser('b12creator')
  const market = await createMarket(creatorJar, { initialLiquidity: 100 })

  const before = await getBalance(traderJar)
  let reportedNetCost = 0

  // Alternate 1-share YES buys and sells 10 times (20 trades total)
  for (let i = 0; i < 10; i++) {
    const buy  = await ammTrade(traderJar, market.id, 'YES', 'BUY',  1)
    const sell = await ammTrade(traderJar, market.id, 'YES', 'SELL', 1)
    reportedNetCost += buy.totalCost + sell.totalCost
  }

  const after = await getBalance(traderJar)
  const actualNetChange = before - after

  await check('B12a: reported cumulative net cost of 20 micro round-trips ≤ $0.02', async () => {
    assert(Math.abs(reportedNetCost) <= 0.02,
      `reported net cost over 20 micro trades should be near $0, got ${reportedNetCost.toFixed(6)}`)
    console.log(`    20 micro-trade reported net cost: ${reportedNetCost.toFixed(6)}`)
  })

  await check('B12b: actual balance change matches reported net cost within $0.001', async () => {
    assertApprox(actualNetChange, reportedNetCost,
      `actual balance change (${actualNetChange.toFixed(6)}) should equal reported net cost (${reportedNetCost.toFixed(6)})`, 0.001)
  })

  await check('B12c: final actual balance drift from starting balance ≤ $0.02', async () => {
    assertApprox(after, before,
      `trader balance after 20 micro round-trips (${after.toFixed(6)}) should be near starting balance (${before.toFixed(6)})`, 0.02)
    console.log(`    start=${before.toFixed(6)}, end=${after.toFixed(6)}, drift=${Math.abs(after - before).toFixed(6)}`)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2]?.toLowerCase() || 'all'

  if (!['all', 'api', 'lifecycle'].includes(mode)) {
    console.error(`Unknown mode: "${mode}". Use: all | api | lifecycle`)
    process.exit(1)
  }

  console.log('════════════════════════════════════════════════════════════════════════')
  console.log('  Money Conservation Simulation')
  console.log('════════════════════════════════════════════════════════════════════════')
  console.log(`  BASE_URL : ${BASE_URL}`)
  console.log(`  Mode     : ${mode}`)
  console.log(`  Run tag  : ${RUN}`)

  await waitForServer()
  console.log('  Server ready.\n')

  const runApi = mode === 'all' || mode === 'api'
  const runLifecycle = mode === 'all' || mode === 'lifecycle'

  if (runApi) {
    section('PART A — API-Only Conservation Invariants')
    await partA_ammBuyCostMatchesBalanceDecrease()
    await partA_ammSellProceedsMatchesBalanceIncrease()
    await partA_roundTripResidual()
    await partA_multiUserSumInvariant()
    await partA_exchangeBidReservation()
    await partA_exchangeCancelFullRefund()
    await partA_exchangeFillZeroSum()
    await partA_exchangeNakedShortAskReserveFlow()
  }

  if (runLifecycle) {
    if (!process.env.DATABASE_URL) {
      console.error('\n  ⚠️  DATABASE_URL not set — lifecycle scenarios require direct DB access.')
      console.error('     Either set DATABASE_URL or run with mode=api to skip lifecycle tests.\n')
      process.exit(1)
    }
    section('PART B — Full Lifecycle Conservation Invariants')
    await partB_zeroTradeMarket()
    await partB_singleSidedMarket()
    await partB_creatorAsActiveTrader()
    await partB_disputeRollbackConservation()
    await partB_precisionDriftUnderManyTrades()
  }

  console.log('\n════════════════════════════════════════════════════════════════════════')
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed (${passCount + failCount} total)`)
  if (failures.length > 0) {
    console.log('\n  Failures:')
    for (const f of failures) {
      console.error(`    ✗ ${f.label}`)
      console.error(`        ${f.err}`)
    }
  }
  console.log('════════════════════════════════════════════════════════════════════════')
  process.exit(failCount > 0 ? 1 : 0)
}

main()
  .catch(err => { console.error('\nFatal error:', err); process.exit(1) })
  .finally(() => prisma && prisma.$disconnect())
