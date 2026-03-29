#!/usr/bin/env node
/**
 * Deferred settlement regression test.
 *
 * Verifies that:
 * 1) Liquidity remains locked immediately after provisional resolution.
 * 2) Open positions are not closed during dispute window.
 * 3) After dispute window has elapsed, immutable finalization unlocks creator
 *    liquidity and closes open positions.
 */

require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

class CookieJar {
  constructor() {
    this.cookies = {}
  }

  setCookies(setCookieHeader) {
    if (Array.isArray(setCookieHeader)) {
      setCookieHeader.forEach((h) => this.parseCookie(h))
    } else if (setCookieHeader) {
      this.parseCookie(setCookieHeader)
    }
  }

  parseCookie(cookieStr) {
    const [nameValue] = cookieStr.split(';')
    const [name, value] = nameValue.split('=')
    if (name && value) this.cookies[name.trim()] = value
  }

  getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
}

async function request(method, path, body = null, jar = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (jar) {
    const cookieHeader = jar.getCookieHeader()
    if (cookieHeader) headers.Cookie = cookieHeader
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const setCookieHeaders = res.headers.getSetCookie?.() || []
  if (jar && setCookieHeaders.length > 0) {
    jar.setCookies(setCookieHeaders)
  }

  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  return { status: res.status, ok: res.ok, data }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function approxEqual(actual, expected, tolerance = 0.0001) {
  return Math.abs(actual - expected) <= tolerance
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`)
      if (res.ok) return
    } catch {
      // retry
    }
    await sleep(500)
  }
  throw new Error('Server did not start within 20 seconds')
}

async function registerUniqueUser(prefix) {
  const jar = new CookieJar()
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    email: `${prefix}-${suffix}@example.com`,
    username: `${prefix}_${suffix}`,
    password: 'password123',
  }

  const res = await request('POST', '/api/auth/register', payload, jar)
  assert(res.ok, `Register failed for ${prefix}: ${JSON.stringify(res.data)}`)
  return { jar, user: res.data.user }
}

async function run() {
  console.log('Running deferred settlement regression test...')
  await waitForServer()

  const creator = await registerUniqueUser('creator')
  const trader = await registerUniqueUser('trader')

  const initialLiquidity = 100
  const buyShares = 80

  const createRes = await request(
    'POST',
    '/api/markets',
    {
      title: `Deferred settlement regression ${Date.now()}`,
      description: 'Checks that settlement is deferred until dispute window expiry.',
      category: 'Test',
      endDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      resolutionSource: 'https://example.com',
      initialLiquidity,
      priorProbability: 0.5,
      disputeWindowHours: 1,
      tags: ['regression', 'deferred-settlement'],
    },
    creator.jar
  )
  assert(createRes.ok, `Create market failed: ${JSON.stringify(createRes.data)}`)
  const marketId = createRes.data.market.id

  const buyRes = await request(
    'POST',
    `/api/markets/${marketId}/trade`,
    { outcome: 'YES', type: 'BUY', shares: buyShares },
    trader.jar
  )
  assert(buyRes.ok, `Trader buy failed: ${JSON.stringify(buyRes.data)}`)

  const resolveRes = await request(
    'POST',
    `/api/markets/${marketId}/resolve`,
    { outcome: 'YES' },
    creator.jar
  )
  assert(resolveRes.ok, `Resolve failed: ${JSON.stringify(resolveRes.data)}`)
  assert(resolveRes.data.settlementPending === true, 'Expected settlementPending=true after provisional resolution')

  const creatorPortfolioAfterResolve = await request('GET', '/api/portfolio', null, creator.jar)
  assert(creatorPortfolioAfterResolve.ok, `Creator portfolio failed: ${JSON.stringify(creatorPortfolioAfterResolve.data)}`)
  const lockedAfterResolve = creatorPortfolioAfterResolve.data.stats.liquidityLocked
  assert(
    approxEqual(lockedAfterResolve, initialLiquidity),
    `Liquidity should remain locked during dispute window. Expected ${initialLiquidity}, got ${lockedAfterResolve}`
  )

  const traderPortfolioAfterResolve = await request('GET', '/api/portfolio', null, trader.jar)
  assert(traderPortfolioAfterResolve.ok, `Trader portfolio failed: ${JSON.stringify(traderPortfolioAfterResolve.data)}`)
  assert(
    traderPortfolioAfterResolve.data.stats.totalPositions > 0,
    `Open positions should not be closed during dispute window. Got totalPositions=${traderPortfolioAfterResolve.data.stats.totalPositions}`
  )

  // Force dispute window to be elapsed by backdating resolutionTime.
  await prisma.market.update({
    where: { id: marketId },
    data: { resolutionTime: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  })

  // Trigger finalization path.
  const creatorPortfolioAfterFinalize = await request('GET', '/api/portfolio', null, creator.jar)
  assert(creatorPortfolioAfterFinalize.ok, `Creator portfolio after finalize failed: ${JSON.stringify(creatorPortfolioAfterFinalize.data)}`)
  const lockedAfterFinalize = creatorPortfolioAfterFinalize.data.stats.liquidityLocked
  assert(
    approxEqual(lockedAfterFinalize, 0),
    `Liquidity should unlock after immutable finalization. Expected 0, got ${lockedAfterFinalize}`
  )

  const traderPortfolioAfterFinalize = await request('GET', '/api/portfolio', null, trader.jar)
  assert(traderPortfolioAfterFinalize.ok, `Trader portfolio after finalize failed: ${JSON.stringify(traderPortfolioAfterFinalize.data)}`)
  assert(
    traderPortfolioAfterFinalize.data.stats.totalPositions === 0,
    `Positions should be closed after immutable finalization. Got totalPositions=${traderPortfolioAfterFinalize.data.stats.totalPositions}`
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        marketId,
        initialLiquidity,
        lockedAfterResolve,
        lockedAfterFinalize,
      },
      null,
      2
    )
  )
}

run()
  .catch((err) => {
    console.error('Deferred settlement regression test failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
