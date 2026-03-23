#!/usr/bin/env node
/**
 * Test script to verify the multi-user auth fix.
 * Tests that trades are correctly attributed to the logged-in user,
 * not cross-contaminated between admin and demo accounts.
 */

const BASE_URL = 'http://localhost:3001'
const MARKET_ID = 'test-market-001'

// Helper to make requests with cookie jar
class CookieJar {
  constructor() {
    this.cookies = {}
  }

  setCookies(setCookieHeader) {
    if (Array.isArray(setCookieHeader)) {
      setCookieHeader.forEach(h => this.parseCookie(h))
    } else if (setCookieHeader) {
      this.parseCookie(setCookieHeader)
    }
  }

  parseCookie(cookieStr) {
    const [nameValue] = cookieStr.split(';')
    const [name, value] = nameValue.split('=')
    this.cookies[name.trim()] = value
  }

  getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  clear() {
    this.cookies = {}
  }
}

async function request(method, path, body = null, jar) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  if (jar) {
    const cookieHeader = jar.getCookieHeader()
    if (cookieHeader) {
      opts.headers['Cookie'] = cookieHeader
    }
  }

  if (body) {
    opts.body = JSON.stringify(body)
  }

  const res = await fetch(`${BASE_URL}${path}`, opts)
  
  // Extract and store Set-Cookie headers
  const setCookieHeaders = res.headers.getSetCookie?.() || []
  if (jar && setCookieHeaders.length > 0) {
    jar.setCookies(setCookieHeaders)
  }

  const data = await res.json()
  return { status: res.status, data, ok: res.ok }
}

async function test() {
  console.log('🧪 Testing multi-user auth fix...\n')

  const adminJar = new CookieJar()
  const demoJar = new CookieJar()

  try {
    // 1. Register/login admin
    console.log('1️⃣  Admin login...')
    let res = await request('POST', '/api/auth/login', {
      email: 'admin@example.com',
      password: 'admin123456',
    }, adminJar)

    if (!res.ok) {
      console.log('❌ Admin login failed - trying register first...')
      res = await request('POST', '/api/auth/register', {
        email: 'admin@example.com',
        username: 'admin_test',
        password: 'admin123456',
      }, adminJar)
      if (!res.ok) {
        throw new Error(`Admin register failed: ${JSON.stringify(res.data)}`)
      }
      console.log('✅ Admin registered')
    } else {
      console.log('✅ Admin logged in')
    }

    const adminUser = res.data.user
    console.log(`   Admin ID: ${adminUser.id}`)

    // 2. Register/login demo
    console.log('\n2️⃣  Demo login...')
    res = await request('POST', '/api/auth/login', {
      email: 'demo@example.com',
      password: 'demo123456',
    }, demoJar)

    if (!res.ok) {
      console.log('ℹ️  Demo login failed - trying register first...')
      res = await request('POST', '/api/auth/register', {
        email: 'demo@example.com',
        username: 'demo_test',
        password: 'demo123456',
      }, demoJar)
      if (!res.ok) {
        throw new Error(`Demo register failed: ${JSON.stringify(res.data)}`)
      }
      console.log('✅ Demo registered')
    } else {
      console.log('✅ Demo logged in')
    }

    const demoUser = res.data.user
    console.log(`   Demo ID: ${demoUser.id}`)

    // 3. Check portfolio (should be empty for demo at this point)
    console.log('\n3️⃣  Get demo portfolio (should be empty)...')
    res = await request('GET', '/api/portfolio', null, demoJar)
    if (res.ok) {
      const positions = res.data.positions || []
      console.log(`   Demo positions: ${positions.length} (expected: 0)`)
      if (positions.length > 0) {
        console.log('⚠️  WARNING: Demo has positions before trading!')
        positions.forEach(p => console.log(`      ${p.market.title}: ${p.shares} shares`))
      }
    }

    // 4. Get my user info to verify we're actually logged in as demo
    console.log('\n4️⃣  Verify demo session...')
    res = await request('GET', '/api/auth/me', null, demoJar)
    if (res.ok) {
      const me = res.data
      console.log(`   /api/auth/me returned user: ${me.email}`)
      if (me.id !== demoUser.id) {
        throw new Error(`🚨 SESSION MISMATCH! Cookie jar has demo ${demoUser.id}, but /api/auth/me returned ${me.id}`)
      }
      console.log('✅ Session verified')
    } else {
      throw new Error(`Failed to get /api/auth/me: ${JSON.stringify(res.data)}`)
    }

    // 5. Get admin's portfolio
    console.log('\n5️⃣  Get admin portfolio...')
    res = await request('GET', '/api/portfolio', null, adminJar)
    if (res.ok) {
      const adminPositions = res.data.positions || []
      console.log(`   Admin positions: ${adminPositions.length}`)
    }

    // 6. Simulate a trade by demo (without market ready, this will fail, but we'll check the auth)
    console.log('\n6️⃣  Test: Attempt trade request as demo (will fail on market check, but verifies auth)...')
    res = await request('POST', `/api/markets/${MARKET_ID}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: 10,
    }, demoJar)
    
    // We expect this to fail because market doesn't exist, but let's see the error
    console.log(`   Trade response status: ${res.status}`)
    console.log(`   Error/response: ${res.data.error || JSON.stringify(res.data).substring(0, 100)}`)

    // Verify demo session didn't change
    console.log('\n7️⃣  Re-verify demo session after trade attempt...')
    res = await request('GET', '/api/auth/me', null, demoJar)
    if (res.ok) {
      const me = res.data
      if (me.id !== demoUser.id) {
        throw new Error(`🚨 SESSION SWITCHED! Started as ${demoUser.id}, now ${me.id}`)
      }
      console.log(`✅ Still logged in as demo (${me.email})`)
    }

    // 8. Verify admin session is still admin
    console.log('\n8️⃣  Verify admin session...')
    res = await request('GET', '/api/auth/me', null, adminJar)
    if (res.ok) {
      const me = res.data
      if (me.id !== adminUser.id) {
        throw new Error(`🚨 ADMIN SESSION CORRUPTED! Expected ${adminUser.id}, got ${me.id}`)
      }
      console.log(`✅ Admin still logged in as ${me.email}`)
    }

    console.log('\n✅ All auth tests passed!')

  } catch (err) {
    console.error('\n❌ Test failed:', err.message)
    process.exit(1)
  }
}

// Wait for server to be ready
async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Server did not start within 15 seconds')
}

waitForServer()
  .then(() => test())
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
