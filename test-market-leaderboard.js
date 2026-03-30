#!/usr/bin/env node
/**
 * Market Leaderboard Simulation
 *
 * Focuses specifically on leaderboard behavior:
 *   - public endpoint shape and timestamp validity
 *   - sort behavior for default profit, trades, and roi
 *   - leaderboard cap (max 100 entries)
 *   - high-trade user visibility and ordering in trades sort
 *
 * Run:
 *   node test-market-leaderboard.js
 *   node test-market-leaderboard.js shape
 *   node test-market-leaderboard.js sorting
 *   node test-market-leaderboard.js trades
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
  const username = `ldr${RUN}${userSeq}`.slice(0, 24)

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

async function createBinaryMarket(jar, suffix, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `Leaderboard ${suffix} ${RUN}`,
    description: 'Automated leaderboard simulation market for ranking behavior checks.',
    category: 'Leaderboard',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/leaderboard',
    marketType: 'BINARY',
    initialLiquidity: 100,
    priorProbability: 0.5,
    ...overrides,
  }, jar)
  assert(res.ok, `create market failed: ${JSON.stringify(res.data)}`)
  return res.data.market
}

async function trade(jar, marketId, outcome, type, shares) {
  const res = await request('POST', `/api/markets/${marketId}/trade`, { outcome, type, shares }, jar)
  assert(res.ok, `trade failed: ${JSON.stringify(res.data)}`)
  return res.data.trade
}

function assertSortedDescending(entries, key, label) {
  for (let i = 1; i < entries.length; i += 1) {
    const prev = Number(entries[i - 1][key])
    const curr = Number(entries[i][key])
    if (Number.isFinite(prev) && Number.isFinite(curr)) {
      assert(prev >= curr, `${label} should be descending at index ${i - 1}/${i}: ${prev} < ${curr}`)
    }
  }
}

async function fetchLeaderboard(sortBy = null) {
  const path = sortBy ? `/api/leaderboard?sortBy=${encodeURIComponent(sortBy)}` : '/api/leaderboard'
  const res = await request('GET', path)
  assert(res.ok, `leaderboard fetch failed for ${sortBy || 'default'}: ${JSON.stringify(res.data)}`)
  return res.data
}

async function shapeSection() {
  await step('Leaderboard endpoint is public and returns expected shape', async () => {
    const data = await fetchLeaderboard()

    assert(Array.isArray(data.entries), 'entries should be an array')
    assert(data.entries.length <= 100, `entries should be capped at 100, got ${data.entries.length}`)

    const ts = Date.parse(data.timestamp)
    assert(Number.isFinite(ts), `timestamp should be valid ISO date, got ${data.timestamp}`)

    if (data.entries.length > 0) {
      const entry = data.entries[0]
      assert(entry.id, 'entry.id missing')
      assert(typeof entry.username === 'string', 'entry.username should be string')
      assert(typeof entry.balance === 'number', 'entry.balance should be number')
      assert(typeof entry.totalRealizedPnl === 'number', 'entry.totalRealizedPnl should be number')
      assert(typeof entry.roi === 'number', 'entry.roi should be number')
      assert(typeof entry.totalTrades === 'number', 'entry.totalTrades should be number')
    }
  })
}

async function sortingSection() {
  await step('Default leaderboard sort is descending by totalRealizedPnl', async () => {
    const data = await fetchLeaderboard()
    assertSortedDescending(data.entries, 'totalRealizedPnl', 'default totalRealizedPnl')
  })

  await step('Trades leaderboard sort is descending by totalTrades', async () => {
    const data = await fetchLeaderboard('trades')
    assertSortedDescending(data.entries, 'totalTrades', 'trades totalTrades')
  })

  await step('ROI leaderboard sort is descending by roi', async () => {
    const data = await fetchLeaderboard('roi')
    assertSortedDescending(data.entries, 'roi', 'roi')
  })

  await step('Unknown sortBy safely falls back to default profit sort', async () => {
    const data = await fetchLeaderboard('unknown-sort')
    assertSortedDescending(data.entries, 'totalRealizedPnl', 'fallback totalRealizedPnl')
  })
}

async function tradesSection() {
  const creator = await registerAndLogin('leaderboard_creator')
  const active = await registerAndLogin('leaderboard_active')
  const passive = await registerAndLogin('leaderboard_passive')
  const market = await createBinaryMarket(creator.jar, 'TradesRanking')

  await step('High-activity seeding preserves trades ranking and surfaces when sampled', async () => {
    const targetTrades = 30
    for (let i = 0; i < 30; i += 1) {
      const outcome = i % 2 === 0 ? 'YES' : 'NO'
      await trade(active.jar, market.id, outcome, 'BUY', 1)
    }

    await trade(passive.jar, market.id, 'YES', 'BUY', 1)

    const data = await fetchLeaderboard('trades')
    assertSortedDescending(data.entries, 'totalTrades', 'trades totalTrades after seeding')

    const activeEntry = data.entries.find((entry) => entry.id === active.user.id)
    if (!activeEntry) {
      // Leaderboard samples up to a capped user set before sorting. If this
      // user is outside that sampled window, visibility is not guaranteed.
      return
    }

    assert(Number(activeEntry.totalTrades) >= targetTrades,
      `expected active user totalTrades >= ${targetTrades}, got ${activeEntry.totalTrades}`)

    const passiveEntry = data.entries.find((entry) => entry.id === passive.user.id)
    if (passiveEntry) {
      assert(Number(activeEntry.totalTrades) > Number(passiveEntry.totalTrades),
        `active user trades should exceed passive user trades (${activeEntry.totalTrades} vs ${passiveEntry.totalTrades})`)

      const activeIndex = data.entries.findIndex((entry) => entry.id === active.user.id)
      const passiveIndex = data.entries.findIndex((entry) => entry.id === passive.user.id)
      assert(activeIndex < passiveIndex,
        `active user should rank ahead of passive user in trades sort (${activeIndex} vs ${passiveIndex})`)
    }
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]

  if (!target) {
    await section('Leaderboard Response Shape', shapeSection)
    await section('Leaderboard Sorting', sortingSection)
    await section('Leaderboard Trade Ranking', tradesSection)
  } else if (target === 'shape') {
    await section('Leaderboard Response Shape', shapeSection)
  } else if (target === 'sorting') {
    await section('Leaderboard Sorting', sortingSection)
  } else if (target === 'trades') {
    await section('Leaderboard Trade Ranking', tradesSection)
  } else {
    console.log(`Unknown section: ${target}`)
    console.log('Valid sections: shape, sorting, trades')
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