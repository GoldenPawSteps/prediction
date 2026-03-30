#!/usr/bin/env node
/**
 * UI/UX Simulation Test
 *
 * Comprehensive UI/UX-driven simulation that validates:
 *   - Core route surface availability and key UI affordances
 *   - User flow contracts (auth, create, discover, read data)
 *   - UX error handling (not found, auth gates, invalid payload behavior)
 *
 * Run:
 *   node test-ui-ux-simulation.js
 *   node test-ui-ux-simulation.js surface
 *   node test-ui-ux-simulation.js flow
 *   node test-ui-ux-simulation.js resilience
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

  const started = Date.now()
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  })
  const elapsedMs = Date.now() - started

  const setCookies = res.headers.getSetCookie?.() || []
  if (jar && setCookies.length) jar.setCookies(setCookies)

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = null }

  return { ok: res.ok, status: res.status, text, data, elapsedMs }
}

async function requestPage(path, jar = null) {
  const headers = {}
  if (jar) headers.Cookie = jar.getCookieHeader()

  const started = Date.now()
  const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers })
  const elapsedMs = Date.now() - started

  const setCookies = res.headers.getSetCookie?.() || []
  if (jar && setCookies.length) jar.setCookies(setCookies)

  const text = await res.text()
  return { ok: res.ok, status: res.status, text, elapsedMs }
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
  const username = `uiux${RUN}${userSeq}`.slice(0, 24)

  const reg = await request('POST', '/api/auth/register', {
    email,
    username,
    password: 'password123',
  })
  assert(reg.ok, `register failed: ${JSON.stringify(reg.data || reg.text)}`)

  const login = await request('POST', '/api/auth/login', {
    email,
    password: 'password123',
  }, jar)
  assert(login.ok, `login failed: ${JSON.stringify(login.data || login.text)}`)

  return { jar, user: reg.data.user }
}

async function getBalance(jar) {
  const res = await request('GET', '/api/auth/me', null, jar)
  assert(res.ok, `GET /api/auth/me failed: ${JSON.stringify(res.data || res.text)}`)
  const direct = Number(res.data?.balance)
  const nested = Number(res.data?.user?.balance)
  if (Number.isFinite(direct)) return direct
  if (Number.isFinite(nested)) return nested
  throw new Error(`Could not read balance from /api/auth/me: ${JSON.stringify(res.data)}`)
}

async function createBinaryMarket(jar, titleSuffix, overrides = {}) {
  const res = await request('POST', '/api/markets', {
    title: `UIUX ${titleSuffix} ${RUN}`,
    description: 'UI/UX simulation market for route and interaction-flow validation.',
    category: 'UIUX',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/uiux',
    marketType: 'BINARY',
    initialLiquidity: 110,
    priorProbability: 0.52,
    ...overrides,
  }, jar)
  assert(res.ok, `create market failed: ${JSON.stringify(res.data || res.text)}`)
  assert(res.status === 201, `expected 201, got ${res.status}`)
  return res.data.market
}

async function surfaceSection() {
  const routes = [
    '/',
    '/leaderboard',
    '/portfolio',
    '/auth/login',
    '/auth/register',
    '/markets/create',
  ]

  await step('Core UI routes render successfully without server errors', async () => {
    for (const route of routes) {
      const page = await requestPage(route)
      assert(page.status < 500, `${route} should not return 5xx (got ${page.status})`)
      assert(page.text.includes('<html') || page.text.includes('<!DOCTYPE html'), `${route} should return HTML`)
    }
  })

  await step('Global shell branding and title metadata are present on home page', async () => {
    const home = await requestPage('/')
    assert(home.ok, `home should return 2xx, got ${home.status}`)
    assert(home.text.includes('Predictify') || home.text.includes('Prediction Markets'),
      'home page should include product branding or metadata title')
    assert(/<title>.*Predictify/i.test(home.text), 'home page should include Predictify in document title')
  })

  await step('Auth pages expose form affordances for email/password and username', async () => {
    const login = await requestPage('/auth/login')
    const register = await requestPage('/auth/register')

    assert(login.ok, `login page should return 2xx, got ${login.status}`)
    assert(register.ok, `register page should return 2xx, got ${register.status}`)

    assert(/id="email"/.test(login.text), 'login page should include email input id')
    assert(/id="password"/.test(login.text), 'login page should include password input id')
    assert(/id="username"/.test(register.text), 'register page should include username input id')
    assert(/minlength="8"/i.test(register.text) || /minLength="8"/.test(register.text),
      'register page should express minimum password length affordance')
  })
}

async function flowSection() {
  const creator = await registerAndLogin('uiux_creator')
  const trader = await registerAndLogin('uiux_trader')

  await step('Primary user journey can create, discover, and open a market detail route', async () => {
    const before = await getBalance(creator.jar)
    const market = await createBinaryMarket(creator.jar, 'Flow')
    const after = await getBalance(creator.jar)
    assert(before > after, 'creator balance should decrease after market funding')

    const list = await request('GET', `/api/markets?search=${encodeURIComponent(market.title)}`)
    assert(list.ok, `market list should succeed: ${JSON.stringify(list.data || list.text)}`)
    assert(Array.isArray(list.data.markets), 'list response should include markets array')
    assert(list.data.markets.some((m) => m.id === market.id), 'created market should be discoverable via search')

    const detailPage = await requestPage(`/markets/${market.id}`)
    assert(detailPage.status < 500, `market detail route should not 5xx (got ${detailPage.status})`)
  })

  await step('UI data endpoints used by market pages remain coherent after interaction', async () => {
    const market = await createBinaryMarket(creator.jar, 'DataCoherence', { priorProbability: 0.4 })

    const trade = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: 8,
    }, trader.jar)
    assert(trade.ok, `trade should succeed: ${JSON.stringify(trade.data || trade.text)}`)

    const probability = await request('GET', `/api/markets/${market.id}/probability`)
    const chart = await request('GET', `/api/markets/${market.id}/chart`)
    const detail = await request('GET', `/api/markets/${market.id}`)

    assert(probability.ok, 'probability endpoint should succeed')
    assert(chart.ok, 'chart endpoint should succeed')
    assert(detail.ok, 'detail endpoint should succeed')

    assertApprox(Number(probability.data.yes) + Number(probability.data.no), 1,
      'probability yes+no should stay normalized', 0.001)
    assert(Array.isArray(chart.data.priceHistory), 'chart should provide priceHistory array')
    assert(Number(detail.data.totalVolume) >= 0, 'detail should include numeric totalVolume')
  })

  await step('Key UX APIs respond within interactive budget under normal load', async () => {
    const endpoints = ['/api/markets', '/api/leaderboard?sortBy=trades']
    for (const endpoint of endpoints) {
      const res = await request('GET', endpoint)
      assert(res.ok, `${endpoint} should succeed`)
      assert(res.elapsedMs < 4000, `${endpoint} should respond in < 4000ms, got ${res.elapsedMs}ms`)
    }
  })
}

async function resilienceSection() {
  const user = await registerAndLogin('uiux_resilience')

  await step('Not-found page path returns non-2xx without server crash', async () => {
    const page = await requestPage('/this-route-should-not-exist')
    assert(page.status >= 400 && page.status < 500, `unknown route should return 4xx, got ${page.status}`)
  })

  await step('Auth-gated portfolio API rejects anonymous access', async () => {
    const anon = await request('GET', '/api/portfolio')
    assert(!anon.ok, 'anonymous portfolio request should fail')
    assert(anon.status === 401, `expected 401, got ${anon.status}`)
  })

  await step('Invalid market interactions fail cleanly without balance mutation', async () => {
    const market = await createBinaryMarket(user.jar, 'Resilience')
    const before = await getBalance(user.jar)

    const badTrade = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: -5,
    }, user.jar)
    assert(!badTrade.ok, 'negative-share trade should be rejected')

    const badOrder = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 2,
      shares: 3,
    }, user.jar)
    assert(!badOrder.ok, 'invalid price order should be rejected')

    const after = await getBalance(user.jar)
    assertApprox(after, before, 'rejected interactions should not mutate balance', 0.001)
  })
}

async function main() {
  await waitForServer()
  const target = process.argv[2]

  if (!target) {
    await section('Route Surface And Affordances', surfaceSection)
    await section('Primary Interaction Flow', flowSection)
    await section('Resilience And UX Safety', resilienceSection)
  } else if (target === 'surface') {
    await section('Route Surface And Affordances', surfaceSection)
  } else if (target === 'flow') {
    await section('Primary Interaction Flow', flowSection)
  } else if (target === 'resilience') {
    await section('Resilience And UX Safety', resilienceSection)
  } else {
    console.log(`Unknown section: ${target}`)
    console.log('Valid sections: surface, flow, resilience')
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