/**
 * Market Probability Test Suite
 *
 * Focuses specifically on probability behavior:
 *   - Initial probabilities reflect configured priors
 *   - YES/NO trades move probabilities in the expected direction
 *   - Probability endpoint stays normalized (YES + NO ~= 1)
 *   - Detail and probability endpoints stay in sync
 *   - Resolved and INVALID markets expose pinned probabilities
 *   - Multi-outcome child markets expose per-outcome probabilities
 *
 * Run:
 *   node test-market-probability.js
 *   node test-market-probability.js initial
 *   node test-market-probability.js trading
 *   node test-market-probability.js resolution
 *   node test-market-probability.js multi
 */

require('dotenv/config')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const RUN_TAG = Date.now().toString(36)

class CookieJar {
  constructor() { this.cookies = {} }
  setCookies(headers) {
    for (const h of headers) {
      const m = h.match(/^([^=]+)=([^;]*)/)
      if (m) this.cookies[m[1].trim()] = m[2].trim()
    }
  }
  getCookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function request(method, path, body = null, jar = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (jar) opts.headers.Cookie = jar.getCookieHeader()
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE_URL}${path}`, opts)
  const setCookies = res.headers.getSetCookie?.() || []
  if (jar && setCookies.length) jar.setCookies(setCookies)
  let data
  try { data = await res.json() } catch { data = null }
  return { status: res.status, ok: res.ok, data }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

function approxEqual(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol
}

function assertApprox(actual, expected, msg, tol = 0.01) {
  assert(approxEqual(actual, expected, tol), `${msg} - expected ~${expected}, got ${actual} (tol ${tol})`)
}

let passCount = 0
let failCount = 0
const failures = []

function pass(label) {
  passCount++
  console.log(`  ✅ ${label}`)
}

function fail(label, err) {
  failCount++
  failures.push({ label, err: err?.message || String(err) })
  console.error(`  ❌ ${label}: ${err?.message || err}`)
}

async function step(label, fn) {
  try {
    await fn()
    pass(label)
  } catch (e) {
    fail(label, e)
  }
}

async function section(name, fn) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  SECTION: ${name}`)
  console.log('═'.repeat(70))
  try {
    await fn()
  } catch (e) {
    fail(`[${name}] uncaught`, e)
  }
}

async function waitForServer() {
  process.stdout.write('⏳ Waiting for server')
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/markets`)
      if (res.ok) {
        console.log(' ✓')
        return
      }
    } catch {}
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Server did not start within 60 s')
}

async function registerAndLogin(name) {
  const email = `${name}_${RUN_TAG}@test.com`
  const username = `${name}${RUN_TAG}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24)

  const reg = await request('POST', '/api/auth/register', {
    email,
    username,
    password: 'password123',
  })
  assert(reg.ok, `register failed: ${JSON.stringify(reg.data)}`)

  const jar = new CookieJar()
  const login = await request('POST', '/api/auth/login', {
    email,
    password: 'password123',
  }, jar)
  assert(login.ok, `login failed: ${JSON.stringify(login.data)}`)
  return { jar, user: reg.data.user }
}

async function createBinaryMarket(jar, titleSuffix, overrides = {}) {
  const payload = {
    title: `Probability ${titleSuffix} ${RUN_TAG}`,
    description: 'Probability-focused simulation market used to verify prior and post-trade probability behavior.',
    category: 'Probability',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/probability',
    marketType: 'BINARY',
    initialLiquidity: 100,
    priorProbability: 0.5,
    ...overrides,
  }

  const res = await request('POST', '/api/markets', payload, jar)
  assert(res.ok, `create binary market failed: ${JSON.stringify(res.data)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function createMultiMarket(jar, titleSuffix, outcomes) {
  const res = await request('POST', '/api/markets', {
    title: `Probability Multi ${titleSuffix} ${RUN_TAG}`,
    description: 'Multi-outcome probability simulation market used to verify child outcome probabilities.',
    category: 'Probability',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/probability-multi',
    marketType: 'MULTI',
    outcomes,
  }, jar)
  assert(res.ok, `create multi market failed: ${JSON.stringify(res.data)}`)
  return res.data.market
}

async function getProbability(marketId) {
  const res = await request('GET', `/api/markets/${marketId}/probability`)
  assert(res.ok, `probability fetch failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function getMarketDetail(marketId, jar = null) {
  const res = await request('GET', `/api/markets/${marketId}`, null, jar)
  assert(res.ok, `detail fetch failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await request('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function resolveMarket(jar, marketId, outcome) {
  const res = await request('POST', `/api/markets/${marketId}/resolve`, { outcome }, jar)
  assert(res.ok, `resolve failed: ${JSON.stringify(res.data)}`)
  return res.data
}

async function initialSection(users) {
  const { alice } = users

  await step('Initial 50% prior yields near-even probabilities', async () => {
    const market = await createBinaryMarket(alice.jar, 'Fifty', { priorProbability: 0.5 })
    const probability = await getProbability(market.id)
    assertApprox(probability.yes, 0.5, '50% prior yes probability', 0.01)
    assertApprox(probability.no, 0.5, '50% prior no probability', 0.01)
  })

  await step('Initial 75% prior yields higher YES probability', async () => {
    const market = await createBinaryMarket(alice.jar, 'SeventyFive', { priorProbability: 0.75 })
    const probability = await getProbability(market.id)
    assert(probability.yes > probability.no, '75% prior should favor YES')
    assertApprox(probability.yes, 0.75, '75% prior yes probability', 0.03)
  })

  await step('Initial 25% prior yields higher NO probability', async () => {
    const market = await createBinaryMarket(alice.jar, 'TwentyFive', { priorProbability: 0.25 })
    const probability = await getProbability(market.id)
    assert(probability.no > probability.yes, '25% prior should favor NO')
    assertApprox(probability.yes, 0.25, '25% prior yes probability', 0.03)
  })

  await step('Probability endpoint returns 404 for unknown market', async () => {
    const res = await request('GET', '/api/markets/nonexistent-probability-market/probability')
    assert(!res.ok, 'unknown market probability fetch should fail')
    assert(res.status === 404, `expected 404, got ${res.status}`)
  })
}

async function tradingSection(users) {
  const { alice, bob } = users
  const market = await createBinaryMarket(alice.jar, 'Trading', { priorProbability: 0.5 })

  await step('YES buy increases YES probability', async () => {
    const before = await getProbability(market.id)
    await trade(alice.jar, market.id, 'YES', 'BUY', 10)
    const after = await getProbability(market.id)
    assert(after.yes > before.yes, `YES probability should rise (${before.yes} -> ${after.yes})`)
    assert(after.no < before.no, `NO probability should fall (${before.no} -> ${after.no})`)
  })

  await step('NO buy increases NO probability', async () => {
    const before = await getProbability(market.id)
    await trade(bob.jar, market.id, 'NO', 'BUY', 8)
    const after = await getProbability(market.id)
    assert(after.no > before.no, `NO probability should rise (${before.no} -> ${after.no})`)
    assert(after.yes < before.yes, `YES probability should fall (${before.yes} -> ${after.yes})`)
  })

  await step('YES sell moves YES probability downward', async () => {
    const before = await getProbability(market.id)
    await trade(alice.jar, market.id, 'YES', 'SELL', 4)
    const after = await getProbability(market.id)
    assert(after.yes < before.yes, `YES probability should decrease after YES sell (${before.yes} -> ${after.yes})`)
  })

  await step('Probability remains normalized after multiple trades', async () => {
    await trade(alice.jar, market.id, 'YES', 'BUY', 5)
    await trade(bob.jar, market.id, 'NO', 'BUY', 3)
    const probability = await getProbability(market.id)
    assert(probability.yes > 0 && probability.yes < 1, 'YES probability should stay in (0,1)')
    assert(probability.no > 0 && probability.no < 1, 'NO probability should stay in (0,1)')
    assertApprox(probability.yes + probability.no, 1, 'YES+NO normalization', 0.001)
  })

  await step('Market detail and probability endpoint stay in sync for open markets', async () => {
    const probability = await getProbability(market.id)
    const detail = await getMarketDetail(market.id, alice.jar)
    assertApprox(probability.yes, detail.probabilities.yes, 'detail yes probability should match endpoint', 0.001)
    assertApprox(probability.no, detail.probabilities.no, 'detail no probability should match endpoint', 0.001)
  })
}

async function resolutionSection(users) {
  const { alice, bob } = users

  await step('Resolved YES market pins probability to 1/0', async () => {
    const market = await createBinaryMarket(alice.jar, 'ResolvedYes', {
      endDate: new Date(Date.now() + 3000).toISOString(),
      disputeWindowHours: 1,
    })
    await trade(bob.jar, market.id, 'YES', 'BUY', 6)
    await new Promise((r) => setTimeout(r, 3600))
    await getMarketDetail(market.id, alice.jar)
    await resolveMarket(alice.jar, market.id, 'YES')
    const probability = await getProbability(market.id)
    const detail = await getMarketDetail(market.id, alice.jar)
    assertApprox(probability.yes, 1, 'resolved YES endpoint yes probability', 0.0001)
    assertApprox(probability.no, 0, 'resolved YES endpoint no probability', 0.0001)
    assertApprox(detail.probabilities.yes, 1, 'resolved YES detail yes probability', 0.0001)
    assertApprox(detail.probabilities.no, 0, 'resolved YES detail no probability', 0.0001)
  })

  await step('INVALID market pins probability to 0.5/0.5', async () => {
    const market = await createBinaryMarket(alice.jar, 'Invalid', {
      endDate: new Date(Date.now() + 3000).toISOString(),
      disputeWindowHours: 1,
    })
    await trade(bob.jar, market.id, 'YES', 'BUY', 5)
    await new Promise((r) => setTimeout(r, 3600))
    await getMarketDetail(market.id, alice.jar)
    await resolveMarket(alice.jar, market.id, 'INVALID')
    const probability = await getProbability(market.id)
    const detail = await getMarketDetail(market.id, alice.jar)
    assertApprox(probability.yes, 0.5, 'INVALID endpoint yes probability', 0.0001)
    assertApprox(probability.no, 0.5, 'INVALID endpoint no probability', 0.0001)
    assertApprox(detail.probabilities.yes, 0.5, 'INVALID detail yes probability', 0.0001)
    assertApprox(detail.probabilities.no, 0.5, 'INVALID detail no probability', 0.0001)
  })
}

async function multiSection(users) {
  const { alice } = users

  await step('Multi-outcome child probabilities reflect configured priors', async () => {
    const market = await createMultiMarket(alice.jar, 'Priors', [
      { name: 'Alpha', initialLiquidity: 100, priorProbability: 0.6 },
      { name: 'Beta', initialLiquidity: 100, priorProbability: 0.25 },
      { name: 'Gamma', initialLiquidity: 100, priorProbability: 0.15 },
    ])
    const detail = await getMarketDetail(market.id, alice.jar)
    assert(Array.isArray(detail.outcomes), 'multi market should expose outcomes')
    assert(detail.outcomes.length === 3, `expected 3 outcomes, got ${detail.outcomes.length}`)

    const alpha = detail.outcomes.find((outcome) => outcome.outcomeName === 'Alpha')
    const beta = detail.outcomes.find((outcome) => outcome.outcomeName === 'Beta')
    const gamma = detail.outcomes.find((outcome) => outcome.outcomeName === 'Gamma')
    assert(alpha && beta && gamma, 'expected Alpha/Beta/Gamma outcomes')
    assert(alpha.probabilities.yes > beta.probabilities.yes, 'Alpha prior should exceed Beta prior')
    assert(beta.probabilities.yes > gamma.probabilities.yes, 'Beta prior should exceed Gamma prior')
    assertApprox(alpha.probabilities.yes, 0.6, 'Alpha prior probability', 0.03)
    assertApprox(beta.probabilities.yes, 0.25, 'Beta prior probability', 0.03)
    assertApprox(gamma.probabilities.yes, 0.15, 'Gamma prior probability', 0.03)
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]

  try {
    const alice = await registerAndLogin('prob_alice')
    const bob = await registerAndLogin('prob_bob')
    const users = { alice, bob }

    if (!target) {
      await section('Initial Probabilities', async () => initialSection(users))
      await section('Trading Movement', async () => tradingSection(users))
      await section('Resolution Pinning', async () => resolutionSection(users))
      await section('Multi-Outcome Probabilities', async () => multiSection(users))
    } else if (target === 'initial') {
      await section('Initial Probabilities', async () => initialSection(users))
    } else if (target === 'trading') {
      await section('Trading Movement', async () => tradingSection(users))
    } else if (target === 'resolution') {
      await section('Resolution Pinning', async () => resolutionSection(users))
    } else if (target === 'multi') {
      await section('Multi-Outcome Probabilities', async () => multiSection(users))
    } else {
      console.log(`Unknown section: ${target}`)
      console.log('Valid sections: initial, trading, resolution, multi')
      process.exit(1)
    }
  } catch (e) {
    fail('[main]', e)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed`)
  console.log('═'.repeat(70))

  if (failures.length > 0) {
    console.log('\nFailures:')
    failures.forEach(({ label, err }) => {
      console.log(`  • ${label}`)
      console.log(`    ${err}`)
    })
  }

  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})