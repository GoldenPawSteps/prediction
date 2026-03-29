import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const DATABASE_URL = process.env.DATABASE_URL
const BASE_URL = 'http://localhost:3001'
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

class CookieJar {
  constructor() { this.c = {} }
  setCookies(h) { for (const s of h) { const m = s.match(/^([^=]+)=([^;]*)/); if (m) this.c[m[1].trim()] = m[2].trim() } }
  get() { return Object.entries(this.c).map(([k,v]) => k + '=' + v).join('; ') }
}

async function req(method, path, body, jar) {
  const h = { 'Content-Type': 'application/json' }
  if (jar) h.Cookie = jar.get()
  const res = await fetch(BASE_URL + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie?.() || []
  if (jar && sc.length) jar.setCookies(sc)
  const d = await res.json().catch(() => null)
  if (!res.ok) console.log('  HTTP ERROR', res.status, method, path, JSON.stringify(d))
  return { ok: res.ok, status: res.status, data: d }
}
async function bal(jar) { const x = await req('GET', '/api/auth/me', null, jar); return Number(x.data.balance) }

const tag = Date.now().toString(36)
const creator = new CookieJar(), alice = new CookieJar(), bob = new CookieJar()
await Promise.all([
  req('POST', '/api/auth/register', { email: 'c_' + tag + '@x.com', username: 'c_' + tag, password: 'Password1!' }, creator),
  req('POST', '/api/auth/register', { email: 'a_' + tag + '@x.com', username: 'a_' + tag, password: 'Password1!' }, alice),
  req('POST', '/api/auth/register', { email: 'b_' + tag + '@x.com', username: 'b_' + tag, password: 'Password1!' }, bob),
])

const mk = await req('POST', '/api/markets', {
  title: 'B11 debug ' + tag + ' long enough title here',
  description: 'This is a description for our test market here.',
  category: 'Technology',
  endDate: new Date(Date.now() + 5000).toISOString(),
  resolutionSource: 'https://x.com',
  initialLiquidity: 100,
  disputeWindowHours: 720
}, creator)
const mid = mk.data.market.id
console.log('market id:', mid)

await req('POST', '/api/markets/' + mid + '/trade', { outcome: 'YES', type: 'BUY', shares: 30 }, alice)
await req('POST', '/api/markets/' + mid + '/trade', { outcome: 'NO', type: 'BUY', shares: 25 }, bob)

await new Promise(r => setTimeout(r, 6000))
await req('GET', '/api/markets')

const v1 = await req('POST', '/api/markets/' + mid + '/vote', { outcome: 'YES' }, creator)
console.log('YES vote ok:', v1.ok, 'market:', v1.data?.market?.status, v1.data?.market?.resolution)

const d1 = await req('POST', '/api/markets/' + mid + '/dispute', {
  reason: 'The resolution is incorrect. It should resolve NO based on the reference source.',
  proposedOutcome: 'NO'
}, bob)
console.log('dispute ok:', d1.ok, d1.data?.message)

const mDB1 = await db.market.findUnique({ where: { id: mid }, select: { status: true, resolution: true, settledAt: true } })
console.log('after dispute DB:', JSON.stringify(mDB1))

const rv1 = await req('POST', '/api/markets/' + mid + '/vote', { outcome: 'NO' }, alice)
console.log('re-vote alice:', rv1.ok, 'market:', rv1.data?.market?.status, rv1.data?.market?.resolution)

const rv2 = await req('POST', '/api/markets/' + mid + '/vote', { outcome: 'NO' }, bob)
console.log('re-vote bob:', rv2.ok, 'market:', rv2.data?.market?.status, rv2.data?.market?.resolution)

const mDB2 = await db.market.findUnique({ where: { id: mid }, select: { status: true, resolution: true, resolutionTime: true, settledAt: true, disputeWindowHours: true } })
console.log('after re-votes DB:', JSON.stringify(mDB2))

await db.market.update({ where: { id: mid }, data: { resolutionTime: new Date(Date.now() - 721 * 3600000) } })
const mDB3 = await db.market.findUnique({ where: { id: mid }, select: { status: true, resolutionTime: true, settledAt: true } })
console.log('after backdate DB:', JSON.stringify(mDB3))

const p = await req('GET', '/api/portfolio', null, creator)
console.log('portfolio ok:', p.ok)
console.log('portfolio recentlySettledMarkets:', JSON.stringify(p.data?.recentlySettledMarkets?.map(m => m.id)))
await new Promise(r => setTimeout(r, 500))

const mDB4 = await db.market.findUnique({ where: { id: mid }, select: { status: true, resolution: true, settledAt: true } })
console.log('after portfolio DB:', JSON.stringify(mDB4))

const [bc, ba, bb] = await Promise.all([bal(creator), bal(alice), bal(bob)])
console.log('creator='+ bc.toFixed(4), 'alice='+ ba.toFixed(4), 'bob='+ bb.toFixed(4))
console.log('sum=', (bc + ba + bb).toFixed(4), ' (expected=3000)')

await db.$disconnect()
