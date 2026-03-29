#!/usr/bin/env node
/**
 * Money Flow Integrity Test
 *
 * Verifies that the total amount of money in the system is conserved across
 * a market's complete lifecycle: creation → trading → resolution → settlement.
 *
 * Core invariant checked after every scenario:
 *   initialLiquidity + netTradeCost == totalPayout + refundedToCreator
 *
 * Where:
 *   netTradeCost          = sum of all user trade.totalCost values (positive for BUY,
 *                           negative for SELL) recorded before settlement
 *   totalPayout           = sum paid out to winners (or refunded for INVALID)
 *   refundedToCreator     = residual returned to the market creator
 *
 * Additional per-user checks:
 *   balance_after == balance_before - net_trade_spend + settlement_receive
 *
 * Scenarios:
 *   1. YES resolution  – YES holders win $1/share, NO holders get $0
 *   2. NO resolution   – NO holders win $1/share, YES holders get $0
 *   3. INVALID         – everyone refunded at their avgEntryPrice
 *   4. Partial sells before resolution
 *   5. Full exit before resolution (no settlement payout for fully-sold position)
 *
 * Requires:
 *   DATABASE_URL env var (direct DB for dispute-window backdating)
 *   Dev server running at BASE_URL (default http://localhost:3001)
 *
 * Run:
 *   node test-money-flow-integrity.js
 */

require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ─── Utilities ──────────────────────────────────────────────────────────────

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

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

// Floating-point tolerant equality (default ±0.01 to handle numeric precision residue)
function approxEqual(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol
}

function assertApprox(actual, expected, msg, tol = 0.01) {
  assert(
    approxEqual(actual, expected, tol),
    `${msg} — expected ≈${expected.toFixed(6)}, got ${actual.toFixed(6)} (diff ${Math.abs(actual - expected).toFixed(6)}, tol ${tol})`
  )
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE_URL}/api/markets`)
      if (r.status < 500) return
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Server did not start within 20 s')
}

const RUN = Date.now().toString(36)
let userSeq = 0

async function registerUser(role) {
  const jar = new CookieJar()
  const id = `${RUN}_${++userSeq}`
  const payload = {
    email: `${role}_${id}@integrity.test`,
    username: `${role}_${id}`,
    password: 'Password1!',
  }
  const r = await request('POST', '/api/auth/register', payload, jar)
  assert(r.ok, `register ${role} failed: ${JSON.stringify(r.data)}`)
  return { jar, user: r.data.user }
}

async function getBalance(jar) {
  const r = await request('GET', '/api/auth/me', null, jar)
  assert(r.ok, `getBalance /me failed: ${JSON.stringify(r.data)}`)
  return r.data.balance
}

/** Create a BINARY market and return its id + the initialLiquidity used. */
async function createMarket(creatorJar, { initialLiquidity = 100, priorProbability = 0.5 } = {}) {
  const r = await request('POST', '/api/markets', {
    title: `Integrity-Test Market ${RUN}_${Date.now()}`,
    description: 'Automated money-flow integrity check market for lifecycle testing.',
    category: 'Test',
    endDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
    resolutionSource: 'https://example.com/resolution',
    initialLiquidity,
    priorProbability,
    disputeWindowHours: 1,
  }, creatorJar)
  assert(r.ok, `createMarket failed: ${JSON.stringify(r.data)}`)
  return { marketId: r.data.market.id, initialLiquidity }
}

/** Execute a BUY or SELL trade; returns `{ totalCost, shares, type, outcome }` from the response. */
async function trade(jar, marketId, outcome, type, shares) {
  const r = await request('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(r.ok, `trade ${type} ${outcome} x${shares} failed: ${JSON.stringify(r.data)}`)
  return r.data.trade
}

/** Resolve market and return settlementPending flag. */
async function resolveMarket(jar, marketId, outcome) {
  const r = await request('POST', `/api/markets/${marketId}/resolve`, { outcome }, jar)
  assert(r.ok, `resolve ${outcome} failed: ${JSON.stringify(r.data)}`)
  return r.data
}

/**
 * Force the dispute window to be already-elapsed by backdating resolutionTime
 * directly in the DB, then trigger finalization opportunistically via a
 * portfolio fetch (which calls finalizeImmutableResolutions()).
 */
async function forceSettlement(marketId, triggerJar) {
  await prisma.market.update({
    where: { id: marketId },
    data: { resolutionTime: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  })
  // Trigger finalization via the portfolio endpoint (same pathway production uses)
  const r = await request('GET', '/api/portfolio', null, triggerJar)
  assert(r.ok, `portfolio trigger failed: ${JSON.stringify(r.data)}`)
}

// ─── Test runner ────────────────────────────────────────────────────────────

let passCount = 0; let failCount = 0; const failures = []

function pass(label) { passCount++; console.log(`  ✅ ${label}`) }
function fail(label, err) {
  failCount++
  failures.push({ label, err: err?.message || String(err) })
  console.error(`  ❌ ${label}: ${err?.message || err}`)
}

async function check(label, fn) {
  try { await fn(); pass(label) } catch (e) { fail(label, e) }
}

// ─── Scenario helper ─────────────────────────────────────────────────────────

/**
 * Run a full lifecycle for a scenario and return accounting details.
 *
 * @param {string} name - scenario name (for logging)
 * @param {Function} scenarioFn - async fn(ctx) that:
 *    - receives { marketId, creatorJar, users }
 *    - executes trades via ctx.trade(userJar, outcome, type, shares)
 *    - returns { resolution, expectedPayouts: Map<jar, number>, tradeLedger }
 *      where tradeLedger is an array of { totalCost } from API responses
 */
async function runScenario(name, scenarioFn) {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`  SCENARIO: ${name}`)
  console.log('─'.repeat(70))

  // Register fresh users for this scenario to avoid cross-contamination
  const creator = await registerUser('creator')
  const alice   = await registerUser('alice')
  const bob     = await registerUser('bob')
  const carol   = await registerUser('carol')

  // Snapshot starting balances
  const startBalances = {
    creator: await getBalance(creator.jar),
    alice:   await getBalance(alice.jar),
    bob:     await getBalance(bob.jar),
    carol:   await getBalance(carol.jar),
  }
  console.log(`  Starting balances (each should be ≈1000): creator=${startBalances.creator} alice=${startBalances.alice} bob=${startBalances.bob} carol=${startBalances.carol}`)

  // Run the scenario-specific logic
  let scenarioResult
  try {
    scenarioResult = await scenarioFn({
      creator, alice, bob, carol,
      createMarket: (opts) => createMarket(creator.jar, opts),
      trade,
    })
  } catch (e) {
    fail(`[${name}] scenario execution`, e)
    return
  }

  const { marketId, initialLiquidity, resolution, tradeLedger, expectedPayouts } = scenarioResult

  // Resolve the market provisionally
  await check(`[${name}] resolve market → ${resolution}`, async () => {
    const result = await resolveMarket(creator.jar, marketId, resolution)
    assert(result.settlementPending === true, `expected settlementPending=true, got: ${JSON.stringify(result)}`)
  })

  // Snapshot post-resolve (before settlement) balances — liquidity should still be locked
  await check(`[${name}] liquidity still locked after provisional resolution`, async () => {
    const creatorBalanceAfterResolve = await getBalance(creator.jar)
    // Creator should NOT have received refund yet (dispute window still open)
    assertApprox(
      creatorBalanceAfterResolve,
      startBalances.creator - initialLiquidity,
      `Creator balance should be (startBalance - initialLiquidity) before settlement`,
    )
  })

  // Force dispute window expiry and trigger settlement
  await check(`[${name}] force settlement`, async () => {
    await forceSettlement(marketId, creator.jar)
  })

  // Allow the settlement a moment to complete (it's synchronous via portfolio fetch above)
  await new Promise(r => setTimeout(r, 200))

  // Fetch final balances
  const endBalances = {
    creator: await getBalance(creator.jar),
    alice:   await getBalance(alice.jar),
    bob:     await getBalance(bob.jar),
    carol:   await getBalance(carol.jar),
  }
  console.log(`  End balances: creator=${endBalances.creator.toFixed(4)} alice=${endBalances.alice.toFixed(4)} bob=${endBalances.bob.toFixed(4)} carol=${endBalances.carol.toFixed(4)}`)

  // ── Individual balance checks ──────────────────────────────────────────────
  for (const [name_user, entry] of Object.entries(expectedPayouts)) {
    if (name_user === '_totalPayout') continue   // sentinel, not a user
    if (entry.expectedFinalBalance === null) continue  // creator checked via identity
    await check(`[${name}] ${name_user} final balance`, async () => {
      const actual = endBalances[name_user]
      assertApprox(actual, entry.expectedFinalBalance, `${name_user} balance after settlement`, 0.01)
    })
  }

  // ── Conservation invariant ─────────────────────────────────────────────────
  await check(`[${name}] sum of all balances conserved`, async () => {
    const startSum = Object.values(startBalances).reduce((a, b) => a + b, 0)
    const endSum   = Object.values(endBalances).reduce((a, b) => a + b, 0)
    assertApprox(endSum, startSum, `Total system balance (4 users) should be conserved`, 0.02)
  })

  // ── Accounting identity: initialLiquidity + netTradeCost ≈ totalPayout + creatorRefund ──
  await check(`[${name}] accounting identity: initialLiquidity + netTradeCost = totalPayout + creatorRefund`, async () => {
    const netTradeCost = tradeLedger.reduce((sum, t) => sum + t.totalCost, 0)
    const creatorRefund = endBalances.creator - (startBalances.creator - initialLiquidity)
    // creatorRefund = what creator got back (could be 0 if full loss)
    assert(creatorRefund >= -0.02, `Creator refund should not be negative (got ${creatorRefund.toFixed(6)})`)

    const lhs = initialLiquidity + netTradeCost
    const rhs = expectedPayouts._totalPayout + creatorRefund

    console.log(`    initialLiquidity=${initialLiquidity.toFixed(4)} netTradeCost=${netTradeCost.toFixed(4)} totalPayout=${expectedPayouts._totalPayout.toFixed(4)} creatorRefund=${creatorRefund.toFixed(4)}`)
    console.log(`    LHS (initialLiq + netTrade) = ${lhs.toFixed(6)}   RHS (payout + refund) = ${rhs.toFixed(6)}`)

    assertApprox(lhs, rhs, `initialLiquidity + netTradeCost should equal totalPayout + creatorRefund`, 0.02)
  })
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

async function scenario1_YESResolution() {
  await runScenario('YES resolution – YES wins, NO loses', async ({ creator, alice, bob, carol, createMarket, trade }) => {
    const { marketId, initialLiquidity } = await createMarket({ initialLiquidity: 100, priorProbability: 0.5 })

    const tradeLedger = []

    // Alice buys 50 YES
    const t1 = await trade(alice.jar, marketId, 'YES', 'BUY', 50)
    tradeLedger.push(t1)

    // Bob buys 30 NO
    const t2 = await trade(bob.jar, marketId, 'NO', 'BUY', 30)
    tradeLedger.push(t2)

    // Carol buys 20 YES
    const t3 = await trade(carol.jar, marketId, 'YES', 'BUY', 20)
    tradeLedger.push(t3)

    // Expected payouts at YES resolution:
    //   Alice: 50 YES shares × $1 = 50.00
    //   Bob:   30 NO shares × $0 = 0.00
    //   Carol: 20 YES shares × $1 = 20.00
    const aliceExpected   = 1000 - t1.totalCost + 50
    const bobExpected     = 1000 - t2.totalCost + 0
    const carolExpected   = 1000 - t3.totalCost + 20
    const totalPayout     = 50 + 0 + 20

    return {
      marketId, initialLiquidity, resolution: 'YES', tradeLedger,
      expectedPayouts: {
        alice:  { jar: alice.jar,  expectedFinalBalance: aliceExpected   },
        bob:    { jar: bob.jar,    expectedFinalBalance: bobExpected     },
        carol:  { jar: carol.jar,  expectedFinalBalance: carolExpected   },
        creator: { jar: creator.jar, expectedFinalBalance: null },  // checked via identity
        _totalPayout: totalPayout,
      },
    }
  })
}

async function scenario2_NOResolution() {
  await runScenario('NO resolution – NO wins, YES loses', async ({ creator, alice, bob, carol, createMarket, trade }) => {
    const { marketId, initialLiquidity } = await createMarket({ initialLiquidity: 100, priorProbability: 0.5 })

    const tradeLedger = []

    // Alice buys 40 YES
    const t1 = await trade(alice.jar, marketId, 'YES', 'BUY', 40)
    tradeLedger.push(t1)

    // Bob buys 60 NO
    const t2 = await trade(bob.jar, marketId, 'NO', 'BUY', 60)
    tradeLedger.push(t2)

    // Carol buys 10 NO
    const t3 = await trade(carol.jar, marketId, 'NO', 'BUY', 10)
    tradeLedger.push(t3)

    // Expected payouts at NO resolution:
    //   Alice: 40 YES shares × $0 = 0.00
    //   Bob:   60 NO shares × $1 = 60.00
    //   Carol: 10 NO shares × $1 = 10.00
    const aliceExpected   = 1000 - t1.totalCost + 0
    const bobExpected     = 1000 - t2.totalCost + 60
    const carolExpected   = 1000 - t3.totalCost + 10
    const totalPayout     = 0 + 60 + 10

    return {
      marketId, initialLiquidity, resolution: 'NO', tradeLedger,
      expectedPayouts: {
        alice:   { jar: alice.jar,   expectedFinalBalance: aliceExpected  },
        bob:     { jar: bob.jar,     expectedFinalBalance: bobExpected    },
        carol:   { jar: carol.jar,   expectedFinalBalance: carolExpected  },
        creator: { jar: creator.jar, expectedFinalBalance: null },
        _totalPayout: totalPayout,
      },
    }
  })
}

async function scenario3_INVALIDResolution() {
  await runScenario('INVALID resolution – everyone refunded at avg entry price', async ({ creator, alice, bob, carol, createMarket, trade }) => {
    const { marketId, initialLiquidity } = await createMarket({ initialLiquidity: 120, priorProbability: 0.5 })

    const tradeLedger = []

    // Alice buys 50 YES
    const t1 = await trade(alice.jar, marketId, 'YES', 'BUY', 50)
    tradeLedger.push(t1)

    // Bob buys 30 NO
    const t2 = await trade(bob.jar, marketId, 'NO', 'BUY', 30)
    tradeLedger.push(t2)

    // Carol buys 25 YES
    const t3 = await trade(carol.jar, marketId, 'YES', 'BUY', 25)
    tradeLedger.push(t3)

    // INVALID resolution: everyone gets avgEntryPrice × shares back.
    // avgEntryPrice for each trader = totalCost / shares (since single BUY).
    const aliceRefund = t1.totalCost  // avgEntry = t1.totalCost/50, refund = avgEntry × 50 = t1.totalCost
    const bobRefund   = t2.totalCost
    const carolRefund = t3.totalCost

    const aliceExpected  = 1000 - t1.totalCost + aliceRefund  // = 1000 (all in, all out)
    const bobExpected    = 1000 - t2.totalCost + bobRefund    // = 1000
    const carolExpected  = 1000 - t3.totalCost + carolRefund  // = 1000
    const totalPayout    = aliceRefund + bobRefund + carolRefund

    return {
      marketId, initialLiquidity, resolution: 'INVALID', tradeLedger,
      expectedPayouts: {
        alice:   { jar: alice.jar,   expectedFinalBalance: aliceExpected  },
        bob:     { jar: bob.jar,     expectedFinalBalance: bobExpected    },
        carol:   { jar: carol.jar,   expectedFinalBalance: carolExpected  },
        creator: { jar: creator.jar, expectedFinalBalance: null },
        _totalPayout: totalPayout,
      },
    }
  })
}

async function scenario4_PartialSellsBeforeResolution() {
  await runScenario('Partial sell + YES resolution – sold shares excluded from payout', async ({ creator, alice, bob, carol, createMarket, trade }) => {
    const { marketId, initialLiquidity } = await createMarket({ initialLiquidity: 100, priorProbability: 0.5 })

    const tradeLedger = []

    // Alice buys 60 YES then sells 20 → holds 40 YES at settlement
    const t1 = await trade(alice.jar, marketId, 'YES', 'BUY', 60)
    tradeLedger.push(t1)
    const t2 = await trade(alice.jar, marketId, 'YES', 'SELL', 20)
    tradeLedger.push(t2)  // t2.totalCost is negative (proceeds received)

    // Bob buys 40 NO (all lost in YES resolution)
    const t3 = await trade(bob.jar, marketId, 'NO', 'BUY', 40)
    tradeLedger.push(t3)

    // Carol buys 30 YES → holds 30 YES at settlement
    const t4 = await trade(carol.jar, marketId, 'YES', 'BUY', 30)
    tradeLedger.push(t4)

    // Expected at YES resolution:
    //   Alice: paid t1.totalCost, received |t2.totalCost|, then gets 40 × $1 = 40
    //   Bob:   paid t3.totalCost, gets 0
    //   Carol: paid t4.totalCost, gets 30 × $1 = 30
    const aliceExpected  = 1000 - t1.totalCost - t2.totalCost + 40  // total net spend = t1+t2 (t2<0)
    const bobExpected    = 1000 - t3.totalCost + 0
    const carolExpected  = 1000 - t4.totalCost + 30
    const totalPayout    = 40 + 0 + 30

    return {
      marketId, initialLiquidity, resolution: 'YES', tradeLedger,
      expectedPayouts: {
        alice:   { jar: alice.jar,   expectedFinalBalance: aliceExpected  },
        bob:     { jar: bob.jar,     expectedFinalBalance: bobExpected    },
        carol:   { jar: carol.jar,   expectedFinalBalance: carolExpected  },
        creator: { jar: creator.jar, expectedFinalBalance: null },
        _totalPayout: totalPayout,
      },
    }
  })
}

async function scenario5_FullExitBeforeResolution() {
  await runScenario('Full exit before resolution – exited trader gets nothing from settlement', async ({ creator, alice, bob, carol, createMarket, trade }) => {
    const { marketId, initialLiquidity } = await createMarket({ initialLiquidity: 100, priorProbability: 0.5 })

    const tradeLedger = []

    // Alice buys 50 YES then sells all 50 → $0 net shares at settlement
    const t1 = await trade(alice.jar, marketId, 'YES', 'BUY', 50)
    tradeLedger.push(t1)
    const t2 = await trade(alice.jar, marketId, 'YES', 'SELL', 50)
    tradeLedger.push(t2)

    // Bob buys 30 YES → holds at settlement
    const t3 = await trade(bob.jar, marketId, 'YES', 'BUY', 30)
    tradeLedger.push(t3)

    // Carol buys 20 NO → holds at settlement (loses on YES)
    const t4 = await trade(carol.jar, marketId, 'NO', 'BUY', 20)
    tradeLedger.push(t4)

    // Expected at YES resolution:
    //   Alice: bought then sold all → net trade cost = t1+t2, settlement = $0
    //   Bob:   holds 30 YES → gets 30.00
    //   Carol: holds 20 NO → gets 0.00

    // Alice's round-trip residual = t1.totalCost + t2.totalCost. In exact LMSR
    // arithmetic this should be 0; any tiny non-zero value here is numeric precision residue.
    const aliceNetSpend  = t1.totalCost + t2.totalCost
    const aliceExpected  = 1000 - aliceNetSpend + 0
    const bobExpected    = 1000 - t3.totalCost + 30
    const carolExpected  = 1000 - t4.totalCost + 0
    const totalPayout    = 0 + 30 + 0

    await check('[full-exit] Alice round-trip residual should be near zero', async () => {
      assert(Math.abs(aliceNetSpend) <= 0.01, `Alice round-trip residual should be near 0, got ${aliceNetSpend}`)
      console.log(`    Alice round-trip precision residual: ${aliceNetSpend.toFixed(6)}`)
    })

    return {
      marketId, initialLiquidity, resolution: 'YES', tradeLedger,
      expectedPayouts: {
        alice:   { jar: alice.jar,   expectedFinalBalance: aliceExpected  },
        bob:     { jar: bob.jar,     expectedFinalBalance: bobExpected    },
        carol:   { jar: carol.jar,   expectedFinalBalance: carolExpected  },
        creator: { jar: creator.jar, expectedFinalBalance: null },
        _totalPayout: totalPayout,
      },
    }
  })
}

async function scenario6_AsymmetricLiquidity() {
  await runScenario('High prior probability market – YES heavily favored (0.8)', async ({ creator, alice, bob, carol, createMarket, trade }) => {
    const { marketId, initialLiquidity } = await createMarket({ initialLiquidity: 150, priorProbability: 0.8 })

    const tradeLedger = []

    // Alice buys the "expensive" YES side
    const t1 = await trade(alice.jar, marketId, 'YES', 'BUY', 40)
    tradeLedger.push(t1)

    await check('[asymmetric] YES starts expensive (prior=0.8)', async () => {
      // YES price should be > 0.5 initially
      assert(t1.price > 0.5, `YES price should be > 0.5 with prior 0.8, got ${t1.price}`)
    })

    // Bob buys cheap NO side
    const t2 = await trade(bob.jar, marketId, 'NO', 'BUY', 40)
    tradeLedger.push(t2)

    await check('[asymmetric] NO is cheaper per share than YES', async () => {
      assert(t2.totalCost < t1.totalCost, `NO (${t2.totalCost}) should cost less than YES (${t1.totalCost}) at 0.8 prior`)
    })

    // Carol buys some YES
    const t3 = await trade(carol.jar, marketId, 'YES', 'BUY', 20)
    tradeLedger.push(t3)

    // Resolve YES
    const aliceExpected  = 1000 - t1.totalCost + 40
    const bobExpected    = 1000 - t2.totalCost + 0
    const carolExpected  = 1000 - t3.totalCost + 20
    const totalPayout    = 40 + 0 + 20

    return {
      marketId, initialLiquidity, resolution: 'YES', tradeLedger,
      expectedPayouts: {
        alice:   { jar: alice.jar,   expectedFinalBalance: aliceExpected  },
        bob:     { jar: bob.jar,     expectedFinalBalance: bobExpected    },
        carol:   { jar: carol.jar,   expectedFinalBalance: carolExpected  },
        creator: { jar: creator.jar, expectedFinalBalance: null },
        _totalPayout: totalPayout,
      },
    }
  })
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('  Money Flow Integrity Test')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`  BASE_URL: ${BASE_URL}`)

  await waitForServer()
  console.log('  Server is up.\n')

  await scenario1_YESResolution()
  await scenario2_NOResolution()
  await scenario3_INVALIDResolution()
  await scenario4_PartialSellsBeforeResolution()
  await scenario5_FullExitBeforeResolution()
  await scenario6_AsymmetricLiquidity()

  console.log('\n════════════════════════════════════════════════════════════════════')
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed`)
  if (failures.length > 0) {
    console.log('\n  Failures:')
    for (const f of failures) {
      console.error(`    ✗ ${f.label}`)
      console.error(`        ${f.err}`)
    }
  }
  console.log('════════════════════════════════════════════════════════════════════')

  if (failCount > 0) process.exit(1)
}

main()
  .catch(err => {
    console.error('\nFatal error:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
