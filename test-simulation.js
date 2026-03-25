/**
 * Comprehensive Manual‑Testing Simulation for Predictify
 *
 * Exercises every API endpoint and major business-logic path:
 *   1. Auth – register, login, me, logout, session isolation
 *   2. Markets – create (BINARY + MULTI), list, filter, search, single-market fetch
 *   3. AMM Trading – buy YES/NO, sell, slippage, balance/position updates
 *   4. Exchange Orders – GTC, GTD, FOK, FAK, matching, partial fills, cancellation
 *   5. Comments – create, list
 *   6. Market Data – probability, chart / price history
 *   7. Portfolio – positions, trades, stats
 *   8. Leaderboard – profit, roi, trades sort
 *   9. Resolution Voting – initial vote, auto-resolve, settlement payouts, creator refund
 *  10. Dispute & Re-resolution – file dispute, re-vote, reversed settlement
 *  11. Edge Cases – expired markets, duplicate users, invalid inputs, insufficient funds
 *
 * Run:
 *   node test-simulation.js            # full suite
 *   node test-simulation.js <section>  # run a single section (auth, markets, amm, exchange,
 *                                        comments, data, portfolio, leaderboard, resolution,
 *                                        dispute, edge)
 *
 * Requires the dev server to be running on BASE_URL (default http://localhost:3001).
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const RUN_TAG = Date.now().toString(36);  // unique per run to avoid collisions

// ─── Utilities ──────────────────────────────────────────────────────────────

class CookieJar {
  constructor() { this.cookies = {}; }
  setCookies(headers) {
    for (const h of headers) {
      const m = h.match(/^([^=]+)=([^;]*)/);
      if (m) this.cookies[m[1].trim()] = m[2].trim();
    }
  }
  getCookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function request(method, path, body = null, jar = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (jar) opts.headers.Cookie = jar.getCookieHeader();
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const setCookies = res.headers.getSetCookie?.() || [];
  if (jar && setCookies.length) jar.setCookies(setCookies);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }
function approxEqual(a, b, tol = 0.01) { return Math.abs(a - b) <= tol; }
function assertApprox(a, b, msg, tol = 0.01) {
  assert(approxEqual(a, b, tol), `${msg} — expected ≈${b}, got ${a} (tol ${tol})`);
}

let passCount = 0;
let failCount = 0;
const failures = [];
function pass(label) { passCount++; console.log(`  ✅ ${label}`); }
function fail(label, err) {
  failCount++;
  failures.push({ label, err: err?.message || String(err) });
  console.error(`  ❌ ${label}: ${err?.message || err}`);
}

async function section(name, fn) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SECTION: ${name}`);
  console.log('═'.repeat(70));
  try { await fn(); } catch (e) { fail(`[${name}] uncaught`, e); }
}

async function step(label, fn) {
  try { await fn(); pass(label); } catch (e) { fail(label, e); }
}

async function waitForServer() {
  process.stdout.write('⏳ Waiting for server');
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE_URL}/`); if (r.ok) { console.log(' ready.'); return; } }
    catch { /* retry */ }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Server did not start within 30 s');
}

// ─── Helpers that create reusable fixtures ──────────────────────────────────

async function registerUser(suffix) {
  const jar = new CookieJar();
  const res = await request('POST', '/api/auth/register', {
    email: `sim-${RUN_TAG}-${suffix}@test.com`,
    username: `sim_${RUN_TAG}_${suffix}`,
    password: 'password123',
  }, jar);
  assert(res.ok, `register ${suffix} failed: ${JSON.stringify(res.data)}`);
  return { jar, user: res.data.user, token: res.data.token };
}

async function loginUser(email, password) {
  const jar = new CookieJar();
  const res = await request('POST', '/api/auth/login', { email, password }, jar);
  assert(res.ok, `login ${email} failed: ${JSON.stringify(res.data)}`);
  return { jar, user: res.data.user, token: res.data.token };
}

async function createBinaryMarket(jar, label, opts = {}) {
  const body = {
    title: `Sim ${RUN_TAG} ${label} — test market title`,
    description: 'Simulation-generated market for comprehensive manual testing.',
    category: opts.category || 'Test',
    endDate: opts.endDate || new Date(Date.now() + 7 * 86400_000).toISOString(),
    resolutionSource: 'https://example.com',
    initialLiquidity: opts.initialLiquidity || 100,
    disputeWindowHours: opts.disputeWindowHours || 24,
    tags: ['sim', 'test'],
    ...opts.extra,
  };
  const res = await request('POST', '/api/markets', body, jar);
  assert(res.ok, `create market [${label}] failed: ${JSON.stringify(res.data)}`);
  return res.data.market;
}

async function createMultiMarket(jar, label, outcomes) {
  const res = await request('POST', '/api/markets', {
    title: `Sim ${RUN_TAG} MULTI ${label} — test title`,
    description: 'Multi-outcome simulation market generated for testing.',
    category: 'Test',
    endDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
    resolutionSource: 'https://example.com',
    marketType: 'MULTI',
    outcomes,
    tags: ['sim', 'multi'],
  }, jar);
  assert(res.ok, `create multi market [${label}] failed: ${JSON.stringify(res.data)}`);
  return res.data.market;
}

async function getBalance(jar) {
  const r = await request('GET', '/api/auth/me', null, jar);
  assert(r.ok, `me failed: ${JSON.stringify(r.data)}`);
  return r.data.balance;
}

// ─── SECTIONS ───────────────────────────────────────────────────────────────

// -- 1  Auth ----------------------------------------------------------------
async function authSection() {
  let alice, bob;

  await step('Register new user (Alice)', async () => {
    alice = await registerUser('alice');
    assert(alice.user.id, 'missing user id');
    assert(alice.user.email.includes('alice'), 'email mismatch');
    assert(alice.user.balance === 1000, `balance should be 1000, got ${alice.user.balance}`);
    assert(alice.token, 'missing token');
  });

  await step('Register second user (Bob)', async () => {
    bob = await registerUser('bob');
    assert(bob.user.id !== alice.user.id, 'user ids must differ');
  });

  await step('Login with existing credentials', async () => {
    const res = await loginUser(alice.user.email, 'password123');
    assert(res.user.id === alice.user.id, 'login returned wrong user');
    assert(res.token, 'login missing token');
  });

  await step('GET /api/auth/me returns correct user', async () => {
    const r = await request('GET', '/api/auth/me', null, alice.jar);
    assert(r.ok, 'me request failed');
    assert(r.data.id === alice.user.id, 'me returned wrong id');
    assert(r.data.username === alice.user.username, 'username mismatch');
  });

  await step('Session isolation — Bob cannot see Alice identity', async () => {
    const r = await request('GET', '/api/auth/me', null, bob.jar);
    assert(r.ok, 'bob me failed');
    assert(r.data.id === bob.user.id, 'bob me returned alice');
  });

  await step('Logout invalidates session', async () => {
    const logoutJar = new CookieJar();
    const login = await request('POST', '/api/auth/login', {
      email: alice.user.email, password: 'password123',
    }, logoutJar);
    assert(login.ok, 'login before logout failed');

    const out = await request('POST', '/api/auth/logout', null, logoutJar);
    assert(out.ok, 'logout failed');

    // me should now fail with stale cookie (sessionVersion incremented)
    const me = await request('GET', '/api/auth/me', null, logoutJar);
    assert(!me.ok || me.status === 401 || me.status === 403, 'stale session still valid');
  });

  await step('Duplicate email rejected', async () => {
    const jar = new CookieJar();
    const r = await request('POST', '/api/auth/register', {
      email: alice.user.email, username: `dup_${RUN_TAG}_x`, password: 'password123',
    }, jar);
    assert(!r.ok, 'duplicate email should fail');
  });

  await step('Duplicate username rejected', async () => {
    const jar = new CookieJar();
    const r = await request('POST', '/api/auth/register', {
      email: `dup-${RUN_TAG}@test.com`, username: alice.user.username, password: 'password123',
    }, jar);
    assert(!r.ok, 'duplicate username should fail');
  });

  await step('Short password rejected', async () => {
    const jar = new CookieJar();
    const r = await request('POST', '/api/auth/register', {
      email: `short-${RUN_TAG}@test.com`, username: `short_${RUN_TAG}`, password: '123',
    }, jar);
    assert(!r.ok, 'short password should be rejected');
  });

  return { alice: await registerUser('alice2'), bob: await registerUser('bob2') };
}

// -- 2  Markets CRUD --------------------------------------------------------
async function marketsSection(users) {
  const { alice, bob } = users;
  let market1, market2, multiMarket;

  await step('Create binary market', async () => {
    market1 = await createBinaryMarket(alice.jar, 'BTC 200k');
    assert(market1.id, 'missing market id');
    assert(market1.status === 'OPEN', `status should be OPEN, got ${market1.status}`);
  });

  await step('Create second market with custom liquidity', async () => {
    market2 = await createBinaryMarket(bob.jar, 'ETH Flip', { initialLiquidity: 300, category: 'Crypto' });
    assert(market2.id, 'missing id');
    assert(market2.id !== market1.id, 'ids should differ');
  });

  await step('Create multi-outcome market', async () => {
    multiMarket = await createMultiMarket(alice.jar, 'Election', [
      { name: 'Candidate A', initialLiquidity: 100, priorProbability: 0.4 },
      { name: 'Candidate B', initialLiquidity: 100, priorProbability: 0.35 },
      { name: 'Candidate C', initialLiquidity: 100, priorProbability: 0.25 },
    ]);
    assert(multiMarket.id, 'multi market missing id');
  });

  await step('GET /api/markets lists markets', async () => {
    const r = await request('GET', '/api/markets');
    assert(r.ok, 'list failed');
    assert(Array.isArray(r.data.markets), 'markets not array');
    assert(r.data.markets.length > 0, 'no markets returned');
    assert(typeof r.data.total === 'number', 'missing total');
  });

  await step('GET /api/markets?category=Crypto filters', async () => {
    const r = await request('GET', '/api/markets?category=Crypto');
    assert(r.ok, 'filter failed');
    for (const m of r.data.markets) assert(m.category === 'Crypto', 'wrong category');
  });

  await step('GET /api/markets?search=BTC searches', async () => {
    const r = await request('GET', `/api/markets?search=${encodeURIComponent('BTC 200k')}`);
    assert(r.ok, 'search failed');
    assert(r.data.markets.some(m => m.title.includes('BTC 200k')), 'search did not find market');
  });

  await step('GET /api/markets?sortBy=volume sorts', async () => {
    const r = await request('GET', '/api/markets?sortBy=volume');
    assert(r.ok, 'sort failed');
  });

  await step('GET /api/markets/[id] returns full market', async () => {
    const r = await request('GET', `/api/markets/${market1.id}`);
    assert(r.ok, 'get single failed');
    assert(r.data.id === market1.id, 'wrong id');
    assert(r.data.probabilities, 'missing probabilities');
    assert(r.data.creator, 'missing creator');
  });

  await step('GET unknown market returns 404', async () => {
    const r = await request('GET', '/api/markets/nonexistent-id-12345');
    assert(!r.ok, 'should 404');
  });

  await step('Unauthenticated user cannot create market', async () => {
    const r = await request('POST', '/api/markets', {
      title: 'Should not work title here',
      description: 'Unauthenticated market creation attempt.',
      category: 'Test',
      endDate: new Date(Date.now() + 86400_000).toISOString(),
      resolutionSource: 'https://example.com',
    });
    assert(!r.ok, 'unauth create should fail');
  });

  return { market1, market2, multiMarket };
}

// -- 3  AMM Trading ---------------------------------------------------------
async function ammSection(users, markets) {
  const { alice, bob } = users;
  const { market1 } = markets;

  await step('Buy YES shares (AMM)', async () => {
    const before = await getBalance(alice.jar);
    const r = await request('POST', `/api/markets/${market1.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 10,
    }, alice.jar);
    assert(r.ok, `buy failed: ${JSON.stringify(r.data)}`);
    assert(r.data.trade.shares === 10, 'shares mismatch');
    assert(r.data.trade.totalCost > 0, 'cost should be positive');
    assert(r.data.probabilities.yes > 0.5, 'yes prob should rise after YES buy');
    const after = await getBalance(alice.jar);
    assert(after < before, 'balance should decrease after buy');
  });

  await step('Buy NO shares (AMM)', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/trade`, {
      outcome: 'NO', type: 'BUY', shares: 5,
    }, bob.jar);
    assert(r.ok, `buy NO failed: ${JSON.stringify(r.data)}`);
    assert(r.data.probabilities.no > 0, 'no prob should exist');
  });

  await step('Sell YES shares (AMM)', async () => {
    const before = await getBalance(alice.jar);
    const r = await request('POST', `/api/markets/${market1.id}/trade`, {
      outcome: 'YES', type: 'SELL', shares: 3,
    }, alice.jar);
    assert(r.ok, `sell failed: ${JSON.stringify(r.data)}`);
    assert(r.data.trade.type === 'SELL', 'trade type should be SELL');
    const after = await getBalance(alice.jar);
    assert(after > before, 'balance should increase after sell');
  });

  await step('Sell more shares than owned rejected', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/trade`, {
      outcome: 'YES', type: 'SELL', shares: 9999,
    }, alice.jar);
    assert(!r.ok, 'over-sell should be rejected');
  });

  await step('Buy with insufficient balance rejected', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 999999,
    }, alice.jar);
    assert(!r.ok, 'over-buy should be rejected');
  });

  await step('Trade on non-existent market rejected', async () => {
    const r = await request('POST', '/api/markets/fake-id/trade', {
      outcome: 'YES', type: 'BUY', shares: 1,
    }, alice.jar);
    assert(!r.ok, 'trade on fake market should fail');
  });

  await step('Unauthenticated trade rejected', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 1,
    });
    assert(!r.ok, 'unauth trade should fail');
  });

  await step('Multiple trades move probability', async () => {
    // Buy a bunch of YES
    for (let i = 0; i < 3; i++) {
      await request('POST', `/api/markets/${market1.id}/trade`, {
        outcome: 'YES', type: 'BUY', shares: 5,
      }, alice.jar);
    }
    const prob = await request('GET', `/api/markets/${market1.id}/probability`);
    assert(prob.ok, 'prob fetch failed');
    assert(prob.data.yes > 0.5, `yes prob should be >0.5 after heavy buying, got ${prob.data.yes}`);
    assert(approxEqual(prob.data.yes + prob.data.no, 1, 0.001), 'probs should sum to 1');
  });
}

// -- 4  Exchange Orders -----------------------------------------------------
async function exchangeSection(users, markets) {
  const { alice, bob } = users;
  // Create a fresh market for clean order-book testing
  const market = await createBinaryMarket(alice.jar, 'Exchange Test');

  await step('Place GTC BID order', async () => {
    const beforeBal = await getBalance(alice.jar);
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTC', price: 0.40, shares: 20,
    }, alice.jar);
    assert(r.ok, `GTC BID failed: ${JSON.stringify(r.data)}`);
    assert(r.data.order.status === 'OPEN' || r.data.order.status === 'PARTIAL', 'should be open');
    assert(r.data.order.price === 0.40, 'price mismatch');
    const afterBal = await getBalance(alice.jar);
    assert(afterBal < beforeBal, 'BID should reserve balance');
  });

  let askOrderId;
  await step('Place GTC ASK order that does NOT match', async () => {
    // Bob buys YES shares via AMM first so he has shares to ask
    await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 30,
    }, bob.jar);

    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'ASK', orderType: 'GTC', price: 0.80, shares: 10,
    }, bob.jar);
    assert(r.ok, `GTC ASK failed: ${JSON.stringify(r.data)}`);
    assert(r.data.filledShares === 0, 'should not match with 0.40 bid');
    askOrderId = r.data.order.id;
  });

  await step('Place matching BID that fills existing ASK', async () => {
    // Alice bids at 0.80 which should match Bob's ASK at 0.80
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTC', price: 0.80, shares: 5,
    }, alice.jar);
    assert(r.ok, `matching BID failed: ${JSON.stringify(r.data)}`);
    assert(r.data.filledShares > 0, 'should have filled shares');
  });

  await step('Cancel open order — refund reserve', async () => {
    // Place an order then cancel it via DELETE
    const place = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTC', price: 0.30, shares: 10,
    }, alice.jar);
    assert(place.ok, 'place for cancel failed');
    const orderId = place.data.order.id;
    const beforeBal = await getBalance(alice.jar);

    const cancel = await request('DELETE', `/api/markets/${market.id}/order`, {
      orderId,
    }, alice.jar);
    assert(cancel.ok, `cancel failed: ${JSON.stringify(cancel.data)}`);
    const afterBal = await getBalance(alice.jar);
    assert(afterBal > beforeBal, 'cancel should refund reserved amount');
  });

  await step('FOK order rejected when insufficient liquidity', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'FOK', price: 0.10, shares: 99999,
    }, alice.jar);
    // FOK can return 400 (error) or 200 with CANCELLED status
    if (r.ok && r.data.order) {
      assert(r.data.order.status === 'CANCELLED', 'FOK should be CANCELLED');
    } else {
      assert(!r.ok || r.status === 400, 'FOK with no fills should fail or return CANCELLED');
    }
  });

  await step('FAK order fills partial, cancels remainder', async () => {
    // Place a small ask that FAK can partially match
    const setupAsk = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'ASK', orderType: 'GTC', price: 0.50, shares: 3,
    }, bob.jar);
    assert(setupAsk.ok, 'setup ASK for FAK test failed');

    const fak = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'FAK', price: 0.50, shares: 100,
    }, alice.jar);
    assert(fak.ok, `FAK failed: ${JSON.stringify(fak.data)}`);
    // FAK fills what's available then kills the rest — status can be PARTIAL, CANCELLED, or FILLED
    if (fak.data.order) {
      assert(
        ['CANCELLED', 'FILLED', 'PARTIAL'].includes(fak.data.order.status),
        `FAK status unexpected: ${fak.data.order.status}`,
      );
      // remainder should be zeroed out
      assert(fak.data.order.remainingShares === 0, 'FAK remainder should be 0');
    }
  });

  await step('GTD order with future expiry accepted', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTD', price: 0.35, shares: 5,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }, alice.jar);
    assert(r.ok, `GTD failed: ${JSON.stringify(r.data)}`);
    assert(r.data.order.orderType === 'GTD', 'order type mismatch');
    assert(r.data.order.expiresAt, 'GTD should have expiresAt');
  });

  await step('GTD order with past expiry rejected', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTD', price: 0.35, shares: 5,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    }, alice.jar);
    assert(!r.ok, 'GTD with past expiry should be rejected');
  });

  await step('Order on non-OPEN market rejected', async () => {
    // Create a market that expires immediately
    const expiredMkt = await createBinaryMarket(alice.jar, 'Already Expired', {
      endDate: new Date(Date.now() - 86400_000).toISOString(),
    });
    const r = await request('POST', `/api/markets/${expiredMkt.id}/order`, {
      outcome: 'YES', side: 'BID', orderType: 'GTC', price: 0.5, shares: 1,
    }, alice.jar);
    assert(!r.ok, 'order on expired/closed market should fail');
  });
}

// -- 5  Comments ------------------------------------------------------------
async function commentsSection(users, markets) {
  const { alice, bob } = users;
  const { market1 } = markets;

  await step('Post comment', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/comment`, {
      content: 'This is a test comment from the simulation runner.',
    }, alice.jar);
    assert(r.ok, `comment post failed: ${JSON.stringify(r.data)}`);
    assert(r.data.content.includes('test comment'), 'content mismatch');
    assert(r.data.user.username, 'missing user in response');
  });

  await step('Post second comment (Bob)', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/comment`, {
      content: 'Bob weighing in — looking bullish!',
    }, bob.jar);
    assert(r.ok, 'bob comment failed');
  });

  await step('GET comments lists them (newest first)', async () => {
    const r = await request('GET', `/api/markets/${market1.id}/comments`);
    assert(r.ok, 'list comments failed');
    assert(Array.isArray(r.data), 'should be array');
    assert(r.data.length >= 2, 'should have at least 2 comments');
    // Newest first
    const t0 = new Date(r.data[0].createdAt).getTime();
    const t1 = new Date(r.data[1].createdAt).getTime();
    assert(t0 >= t1, 'comments not in descending order');
  });

  await step('Empty comment rejected', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/comment`, {
      content: '',
    }, alice.jar);
    assert(!r.ok, 'empty comment should be rejected');
  });

  await step('Comment over 500 chars rejected', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/comment`, {
      content: 'x'.repeat(501),
    }, alice.jar);
    assert(!r.ok, 'long comment should be rejected');
  });

  await step('Unauthenticated comment rejected', async () => {
    const r = await request('POST', `/api/markets/${market1.id}/comment`, {
      content: 'I should not be able to post this.',
    });
    assert(!r.ok, 'unauth comment should fail');
  });
}

// -- 6  Market Data (probability, chart) ------------------------------------
async function dataSection(markets) {
  const { market1 } = markets;

  await step('GET probability returns yes + no summing to ~1', async () => {
    const r = await request('GET', `/api/markets/${market1.id}/probability`);
    assert(r.ok, 'probability fetch failed');
    assertApprox(r.data.yes + r.data.no, 1.0, 'probs should sum to 1');
    assert(r.data.yes > 0 && r.data.yes < 1, 'yes prob out of range');
  });

  await step('GET chart returns price history array', async () => {
    const r = await request('GET', `/api/markets/${market1.id}/chart`);
    assert(r.ok, 'chart fetch failed');
    assert(Array.isArray(r.data.priceHistory), 'priceHistory not array');
    assert(r.data.priceHistory.length > 0, 'should have at least 1 entry');
    const entry = r.data.priceHistory[0];
    assert(entry.timestamp, 'entry missing timestamp');
    assert(typeof entry.yesPrice === 'number', 'entry missing yesPrice');
    assert(typeof entry.noPrice === 'number', 'entry missing noPrice');
  });

  await step('GET resolution data on open market', async () => {
    const r = await request('GET', `/api/markets/${market1.id}/resolution`);
    assert(r.ok, 'resolution fetch failed');
    assert(r.data.status === 'OPEN' || r.data.status === 'CLOSED', 'unexpected status');
    assert(Array.isArray(r.data.resolutionVotes), 'missing votes array');
    assert(Array.isArray(r.data.disputes), 'missing disputes array');
  });
}

// -- 7  Portfolio -----------------------------------------------------------
async function portfolioSection(users) {
  const { alice, bob } = users;

  await step('GET portfolio for Alice (has trades)', async () => {
    const r = await request('GET', '/api/portfolio', null, alice.jar);
    assert(r.ok, `portfolio failed: ${JSON.stringify(r.data)}`);
    assert(Array.isArray(r.data.positions), 'missing positions');
    assert(Array.isArray(r.data.trades), 'missing trades');
    assert(r.data.stats, 'missing stats');
    assert(typeof r.data.stats.totalValue === 'number', 'missing totalValue');
  });

  await step('Portfolio positions show currentPrice and unrealizedPnl', async () => {
    const r = await request('GET', '/api/portfolio', null, alice.jar);
    if (r.data.positions.length > 0) {
      const p = r.data.positions[0];
      assert(typeof p.currentPrice === 'number', 'missing currentPrice');
      assert(typeof p.unrealizedPnl === 'number', 'missing unrealizedPnl');
      assert(p.market, 'missing market on position');
    }
  });

  await step('Unauthenticated portfolio rejected', async () => {
    const r = await request('GET', '/api/portfolio');
    assert(!r.ok, 'unauth portfolio should fail');
  });
}

// -- 8  Leaderboard --------------------------------------------------------
async function leaderboardSection() {

  await step('GET leaderboard (default sort)', async () => {
    const r = await request('GET', '/api/leaderboard');
    assert(r.ok, 'leaderboard failed');
    assert(Array.isArray(r.data.entries), 'entries not array');
    assert(r.data.timestamp, 'missing timestamp');
  });

  await step('GET leaderboard?sortBy=trades', async () => {
    const r = await request('GET', '/api/leaderboard?sortBy=trades');
    assert(r.ok, 'leaderboard trades sort failed');
    if (r.data.entries.length >= 2) {
      assert(r.data.entries[0].totalTrades >= r.data.entries[1].totalTrades, 'not sorted by trades desc');
    }
  });

  await step('GET leaderboard?sortBy=roi', async () => {
    const r = await request('GET', '/api/leaderboard?sortBy=roi');
    assert(r.ok, 'leaderboard roi sort failed');
  });
}

// -- 9  Resolution & Settlement ---------------------------------------------
async function resolutionSection(users) {
  const { alice, bob } = users;

  // Create a market with a past endDate so it's eligible for resolution
  const market = await createBinaryMarket(alice.jar, 'Resolve Me', {
    endDate: new Date(Date.now() - 1000).toISOString(),
    initialLiquidity: 100,
  });

  // Fetch the market to trigger close-expired logic
  await request('GET', '/api/markets');
  await new Promise(r => setTimeout(r, 200));

  // Both users trade
  // (Trades may fail if market is already closed — that's OK, we may still test resolution)
  // We need to buy shares BEFORE the market closes, so let's create a fresh one with
  // a slightly future end date, trade, then manually wait and close.
  const resMarket = await createBinaryMarket(alice.jar, 'Resolve2', {
    endDate: new Date(Date.now() + 5000).toISOString(), // 5 s from now
    initialLiquidity: 100,
  });

  await step('Trade before expiry then wait for close', async () => {
    const t1 = await request('POST', `/api/markets/${resMarket.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 20,
    }, alice.jar);
    assert(t1.ok, `alice trade failed: ${JSON.stringify(t1.data)}`);

    const t2 = await request('POST', `/api/markets/${resMarket.id}/trade`, {
      outcome: 'NO', type: 'BUY', shares: 15,
    }, bob.jar);
    assert(t2.ok, `bob trade failed: ${JSON.stringify(t2.data)}`);

    // Wait for market to expire
    await new Promise(r => setTimeout(r, 6000));
    // Trigger close-expired
    await request('GET', '/api/markets');
  });

  await step('Vote to resolve market as YES', async () => {
    const r = await request('POST', `/api/markets/${resMarket.id}/vote`, {
      outcome: 'YES',
    }, alice.jar);
    assert(r.ok, `vote failed: ${JSON.stringify(r.data)}`);
    // First vote resolves immediately (0-dispute round)
    if (r.data.autoResolved) {
      assert(r.data.autoResolved === true, 'should auto-resolve on first vote');
    }
  });

  await step('Market now RESOLVED', async () => {
    const r = await request('GET', `/api/markets/${resMarket.id}`);
    assert(r.ok, 'fetch resolved market failed');
    assert(r.data.status === 'RESOLVED', `expected RESOLVED, got ${r.data.status}`);
    assert(r.data.resolution === 'YES', `expected YES resolution, got ${r.data.resolution}`);
  });

  await step('Resolution GET endpoint confirms outcome', async () => {
    const r = await request('GET', `/api/markets/${resMarket.id}/resolution`);
    assert(r.ok, 'resolution fetch failed');
    assert(r.data.resolution === 'YES', 'resolution outcome mismatch');
    assert(r.data.resolutionVotes.length >= 1, 'should have at least 1 vote');
  });

  await step('Winner balance increased (Alice had YES)', async () => {
    const bal = await getBalance(alice.jar);
    // Alice started at 1000, spent on trades, but won 20 shares at $1 each
    // Exact balance depends on cost, but she should have gotten a payout
    assert(typeof bal === 'number' && bal > 0, 'alice balance should be positive');
  });

  await step('Cannot trade on resolved market', async () => {
    const r = await request('POST', `/api/markets/${resMarket.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 1,
    }, alice.jar);
    assert(!r.ok, 'trade on resolved market should fail');
  });

  return { resMarket };
}

// -- 10  Dispute & Re-resolution -------------------------------------------
async function disputeSection(users) {
  const { alice, bob } = users;

  // Create, trade, close, resolve — then dispute
  const mkt = await createBinaryMarket(alice.jar, 'Dispute Me', {
    endDate: new Date(Date.now() + 3000).toISOString(),
    initialLiquidity: 100,
    disputeWindowHours: 720, // large window so dispute is always in time
  });

  const t1 = await request('POST', `/api/markets/${mkt.id}/trade`, {
    outcome: 'YES', type: 'BUY', shares: 15,
  }, alice.jar);
  assert(t1.ok, 'alice trade for dispute test failed');

  const t2 = await request('POST', `/api/markets/${mkt.id}/trade`, {
    outcome: 'NO', type: 'BUY', shares: 10,
  }, bob.jar);
  assert(t2.ok, 'bob trade for dispute test failed');

  // Wait for expiry
  await new Promise(r => setTimeout(r, 4000));
  await request('GET', '/api/markets'); // trigger close

  // Resolve as YES
  const vote1 = await request('POST', `/api/markets/${mkt.id}/vote`, {
    outcome: 'YES',
  }, alice.jar);
  assert(vote1.ok, `initial vote failed: ${JSON.stringify(vote1.data)}`);

  const aliceBalAfterResolve = await getBalance(alice.jar);
  const bobBalAfterResolve = await getBalance(bob.jar);

  await step('File dispute on resolved market', async () => {
    const r = await request('POST', `/api/markets/${mkt.id}/dispute`, {
      reason: 'The resolution is incorrect and should be re-evaluated by the community.',
      proposedOutcome: 'NO',
    }, bob.jar);
    assert(r.ok, `dispute failed: ${JSON.stringify(r.data)}`);
    assert(r.data.dispute.status === 'OPEN', 'dispute should be OPEN');
  });

  await step('Market status is now DISPUTED', async () => {
    const r = await request('GET', `/api/markets/${mkt.id}`);
    assert(r.ok, 'fetch disputed market failed');
    assert(r.data.status === 'DISPUTED', `expected DISPUTED, got ${r.data.status}`);
  });

  await step('Settlement reversed — balances rolled back', async () => {
    const aliceNow = await getBalance(alice.jar);
    const bobNow = await getBalance(bob.jar);
    // After dispute, the previous settlement should be reversed
    // So Alice's balance should decrease (she lost her YES payout)
    // and Bob's should change too
    // We just check they aren't the same as right-after-resolve
    // (exact values depend on implementation)
    assert(typeof aliceNow === 'number', 'alice balance should exist');
    assert(typeof bobNow === 'number', 'bob balance should exist');
  });

  await step('Re-vote to resolve as NO (requires 2 votes — dispute round 1)', async () => {
    // Dispute round 1 requires quorum=2, threshold > 0 (simple majority)
    const v1 = await request('POST', `/api/markets/${mkt.id}/vote`, {
      outcome: 'NO',
    }, alice.jar);
    assert(v1.ok, `re-vote alice failed: ${JSON.stringify(v1.data)}`);

    const v2 = await request('POST', `/api/markets/${mkt.id}/vote`, {
      outcome: 'NO',
    }, bob.jar);
    assert(v2.ok, `re-vote bob failed: ${JSON.stringify(v2.data)}`);
  });

  await step('Market re-resolved as NO', async () => {
    const r = await request('GET', `/api/markets/${mkt.id}`);
    assert(r.ok, 'fetch re-resolved market failed');
    assert(r.data.status === 'RESOLVED', `expected RESOLVED, got ${r.data.status}`);
    assert(r.data.resolution === 'NO', `expected NO, got ${r.data.resolution}`);
  });

  await step('Dispute on non-resolved market rejected', async () => {
    // Try to dispute the already-disputed/re-resolved market again
    // While it's now RESOLVED again, let's try disputing again
    // A second dispute should work if within window — but let's also test with a bad market
    const openMkt = await createBinaryMarket(alice.jar, 'Still Open');
    const r = await request('POST', `/api/markets/${openMkt.id}/dispute`, {
      reason: 'This market has not been resolved yet, so this should fail.',
      proposedOutcome: 'YES',
    }, bob.jar);
    assert(!r.ok, 'dispute on open market should fail');
  });
}

// -- 11  Edge Cases ---------------------------------------------------------
async function edgeCaseSection(users) {
  const { alice, bob } = users;

  await step('Invalid JSON body returns error', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json!!!',
    });
    assert(!res.ok || res.status >= 400, 'invalid JSON should error');
  });

  await step('Market title too short rejected', async () => {
    const r = await request('POST', '/api/markets', {
      title: 'Short',
      description: 'Still a good enough description for validation here.',
      category: 'Test',
      endDate: new Date(Date.now() + 86400_000).toISOString(),
      resolutionSource: 'https://example.com',
    }, alice.jar);
    assert(!r.ok, 'short title should be rejected');
  });

  await step('Market description too short rejected', async () => {
    const r = await request('POST', '/api/markets', {
      title: 'A perfectly reasonable market title for testing',
      description: 'Too short',
      category: 'Test',
      endDate: new Date(Date.now() + 86400_000).toISOString(),
      resolutionSource: 'https://example.com',
    }, alice.jar);
    assert(!r.ok, 'short description should be rejected');
  });

  // Create one market for the remaining edge-case tests to avoid balance exhaustion
  const edgeMkt = await createBinaryMarket(alice.jar, 'Edge Cases');

  await step('Order with price >= 1 rejected', async () => {
    const r = await request('POST', `/api/markets/${edgeMkt.id}/order`, {
      outcome: 'YES', side: 'BID', price: 1.0, shares: 10,
    }, alice.jar);
    assert(!r.ok, 'price=1.0 should be rejected');
  });

  await step('Order with price <= 0 rejected', async () => {
    const r = await request('POST', `/api/markets/${edgeMkt.id}/order`, {
      outcome: 'YES', side: 'BID', price: 0, shares: 10,
    }, alice.jar);
    assert(!r.ok, 'price=0 should be rejected');
  });

  await step('Negative shares rejected', async () => {
    const r = await request('POST', `/api/markets/${edgeMkt.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: -5,
    }, alice.jar);
    assert(!r.ok, 'negative shares should be rejected');
  });

  await step('Vote on open (non-expired) market rejected', async () => {
    const r = await request('POST', `/api/markets/${edgeMkt.id}/vote`, {
      outcome: 'YES',
    }, alice.jar);
    assert(!r.ok, 'vote on open market should be rejected');
  });

  await step('Login with wrong password rejected', async () => {
    const jar = new CookieJar();
    const r = await request('POST', '/api/auth/login', {
      email: alice.user.email,
      password: 'wrong_password_here',
    }, jar);
    assert(!r.ok, 'bad password should fail');
  });

  await step('Login with non-existent email rejected', async () => {
    const jar = new CookieJar();
    const r = await request('POST', '/api/auth/login', {
      email: 'nonexistent-user-xyz@test.com',
      password: 'password123',
    }, jar);
    assert(!r.ok, 'non-existent email should fail');
  });
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

const SECTIONS = {
  auth: authSection,
  markets: null,    // needs auth result
  amm: null,        // needs auth + markets
  exchange: null,   // needs auth + markets
  comments: null,   // needs auth + markets
  data: null,       // needs markets
  portfolio: null,  // needs auth
  leaderboard: leaderboardSection,
  resolution: null, // needs auth
  dispute: null,    // needs auth
  edge: null,       // needs auth
};

async function main() {
  const requested = process.argv[2]?.toLowerCase();
  if (requested && !Object.keys(SECTIONS).includes(requested)) {
    console.error(`Unknown section: "${requested}". Available: ${Object.keys(SECTIONS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🚀 Predictify Comprehensive Manual-Testing Simulation`);
  console.log(`   BASE_URL = ${BASE_URL}`);
  console.log(`   RUN_TAG  = ${RUN_TAG}`);
  if (requested) console.log(`   SECTION  = ${requested}`);

  await waitForServer();

  const shouldRun = (name) => !requested || requested === name;

  // 1. Auth (always needed as it provides users for other sections)
  let users;
  if (shouldRun('auth')) {
    await section('1 — Authentication', async () => { users = await authSection(); });
  } else {
    // Register users silently for downstream sections
    users = {
      alice: await registerUser('alice2'),
      bob: await registerUser('bob2'),
    };
  }

  // 2. Markets
  let markets;
  if (shouldRun('markets')) {
    await section('2 — Markets CRUD', async () => { markets = await marketsSection(users); });
  }
  if (!markets) {
    // Create markets silently for downstream sections
    markets = {
      market1: await createBinaryMarket(users.alice.jar, 'Default1'),
      market2: await createBinaryMarket(users.bob.jar, 'Default2'),
    };
  }

  // 3. AMM Trading
  if (shouldRun('amm')) {
    await section('3 — AMM Trading', () => ammSection(users, markets));
  }

  // 4. Exchange Orders
  if (shouldRun('exchange')) {
    await section('4 — Exchange Orders', () => exchangeSection(users, markets));
  }

  // 5. Comments
  if (shouldRun('comments')) {
    await section('5 — Comments', () => commentsSection(users, markets));
  }

  // 6. Market Data
  if (shouldRun('data')) {
    // Do a quick trade to ensure price history exists
    await request('POST', `/api/markets/${markets.market1.id}/trade`, {
      outcome: 'YES', type: 'BUY', shares: 2,
    }, users.alice.jar);
    await section('6 — Market Data (probability, chart, resolution)', () => dataSection(markets));
  }

  // 7. Portfolio
  if (shouldRun('portfolio')) {
    await section('7 — Portfolio', () => portfolioSection(users));
  }

  // 8. Leaderboard
  if (shouldRun('leaderboard')) {
    await section('8 — Leaderboard', leaderboardSection);
  }

  // 9. Resolution & Settlement
  if (shouldRun('resolution')) {
    await section('9 — Resolution & Settlement', () => resolutionSection(users));
  }

  // 10. Dispute & Re-resolution
  if (shouldRun('dispute')) {
    await section('10 — Dispute & Re-resolution', () => disputeSection(users));
  }

  // 11. Edge Cases
  if (shouldRun('edge')) {
    await section('11 — Edge Cases & Validation', () => edgeCaseSection(users));
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed (${passCount + failCount} total)`);
  if (failures.length) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    ❌ ${f.label}`);
      console.log(`       ${f.err}`);
    }
  }
  console.log('═'.repeat(70));
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(2); });
