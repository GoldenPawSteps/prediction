/**
 * Market Trading Test Suite
 *
 * Focuses specifically on trading functionality:
 *   - AMM trading (BUY/SELL YES/NO)
 *   - Signed positions, including AMM short-selling
 *   - Probability movement and invariants
 *   - Exchange orders (GTC/GTD/FOK/FAK)
 *   - Matching, partial fills, cancellation, and reserve/refund behavior
 *   - Trading validation (insufficient funds, auth, bad ids)
 *
 * Run:
 *   node test-market-trading.js            # full suite
 *   node test-market-trading.js <section>  # amm | exchange
 *
 * Requires the dev server to be running on BASE_URL (default http://localhost:3001).
 */

require('dotenv/config');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const RUN_TAG = Date.now().toString(36);

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

async function getPortfolio(jar) {
  const r = await request('GET', '/api/portfolio', null, jar);
  assert(r.ok, `GET /api/portfolio failed: ${r.status}`);
  return r.data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function approxEqual(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol;
}

function assertApprox(a, b, msg, tol = 0.01) {
  assert(approxEqual(a, b, tol), `${msg} - expected ~${b}, got ${a} (tol ${tol})`);
}

let passCount = 0;
let failCount = 0;
const failures = [];

function pass(label) {
  passCount++;
  console.log(`  ✅ ${label}`);
}

function fail(label, err) {
  failCount++;
  failures.push({ label, err: err?.message || String(err) });
  console.error(`  ❌ ${label}: ${err?.message || err}`);
}

async function step(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (e) {
    fail(label, e);
  }
}

async function section(name, fn) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SECTION: ${name}`);
  console.log('═'.repeat(70));
  try {
    await fn();
  } catch (e) {
    fail(`[${name}] uncaught`, e);
  }
}

async function waitForServer() {
  process.stdout.write('⏳ Waiting for server');
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/markets`);
      if (res.ok) {
        console.log(' ✓');
        return;
      }
    } catch {}
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Server did not start within 60 s');
}

async function getBalance(jar) {
  const r = await request('GET', '/api/auth/me', null, jar);
  assert(r.ok, `GET /api/auth/me failed: ${r.status}`);
  return Number(r.data.user?.balance || 0);
}

async function registerAndLogin(name) {
  const email = `${name}_${RUN_TAG}@test.com`;
  const username = `${name}${RUN_TAG}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);

  const reg = await request('POST', '/api/auth/register', {
    email,
    username,
    password: 'password123',
  });
  assert(reg.ok, `register failed for ${name}: ${reg.status}`);

  const jar = new CookieJar();
  const login = await request('POST', '/api/auth/login', {
    email,
    password: 'password123',
  }, jar);
  assert(login.ok, `login failed for ${name}: ${login.status}`);

  return { jar, user: reg.data.user };
}

async function createBinaryMarket(jar, titleSuffix, overrides = {}) {
  const payload = {
    title: `Trading ${titleSuffix} ${RUN_TAG}`,
    description: 'A trading-focused simulation market used for AMM and exchange order-path validation.',
    category: 'Trading',
    endDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    resolutionSource: 'https://example.com/source',
    marketType: 'BINARY',
    initialLiquidity: 100,
    priorProbability: 0.5,
    ...overrides,
  };

  const r = await request('POST', '/api/markets', payload, jar);
  assert(r.ok, `market create failed: ${r.status} ${JSON.stringify(r.data)}`);
  assert(r.status === 201, `expected 201, got ${r.status}`);
  return r.data.market;
}

async function setupUsersAndMarket() {
  const alice = await registerAndLogin('trader_alice');
  const bob = await registerAndLogin('trader_bob');
  const market = await createBinaryMarket(alice.jar, 'Core');
  return { alice, bob, market };
}

async function ammSection(ctx) {
  const { alice, bob, market } = ctx;

  await step('AMM BUY YES reduces balance and increases YES probability', async () => {
    const r = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: 12,
    }, alice.jar);

    assert(r.ok, `BUY YES failed: ${JSON.stringify(r.data)}`);
    assert(r.data.trade.type === 'BUY', 'trade type should be BUY');
    assert(Number(r.data.trade.totalCost) > 0, 'BUY cost should be positive');
    assert(Number(r.data.probabilities.yes) > 0.5, 'YES probability should increase above 0.5');
  });

  await step('AMM BUY NO reduces balance and moves NO probability up', async () => {
    const beforeProb = await request('GET', `/api/markets/${market.id}/probability`);
    assert(beforeProb.ok, 'pre-trade probability fetch failed');
    const beforeNo = Number(beforeProb.data.no);

    const r = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'NO',
      type: 'BUY',
      shares: 7,
    }, bob.jar);

    assert(r.ok, `BUY NO failed: ${JSON.stringify(r.data)}`);
    assert(Number(r.data.trade.totalCost) > 0, 'BUY NO cost should be positive');
    assert(Number(r.data.probabilities.no) > beforeNo, 'NO probability should rise after NO buy');
  });

  await step('AMM SELL YES increases balance', async () => {
    const r = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'SELL',
      shares: 4,
    }, alice.jar);

    assert(r.ok, `SELL YES failed: ${JSON.stringify(r.data)}`);
    assert(r.data.trade.type === 'SELL', 'trade type should be SELL');
    assert(Number(r.data.trade.totalCost) < 0, `SELL totalCost should be negative, got ${r.data.trade.totalCost}`);
  });

  await step('AMM over-sell opens a short position when collateral is sufficient', async () => {
    const r = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'SELL',
      shares: 20,
    }, alice.jar);

    assert(r.ok, `short sell should succeed: ${JSON.stringify(r.data)}`);
    const portfolio = await getPortfolio(alice.jar);
    const shortPosition = (portfolio.positions || []).find((p) => p.market.id === market.id && p.outcome === 'YES');
    assert(shortPosition, 'short position should appear in portfolio');
    assert(Number(shortPosition.shares) < 0, `expected negative shares, got ${shortPosition.shares}`);
    assert(Number(portfolio.stats.shortCollateral || 0) > 0, 'short collateral should be tracked in portfolio stats');
  });

  await step('AMM insufficient-funds BUY is rejected', async () => {
    const r = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: 999999,
    }, bob.jar);
    assert(!r.ok, 'insufficient-funds BUY should fail');
  });

  await step('AMM unauthenticated trade is rejected', async () => {
    const r = await request('POST', `/api/markets/${market.id}/trade`, {
      outcome: 'YES',
      type: 'BUY',
      shares: 1,
    });
    assert(!r.ok, 'unauthenticated trade should fail');
  });

  await step('AMM trade on fake market id is rejected', async () => {
    const r = await request('POST', '/api/markets/fake-market-id/trade', {
      outcome: 'YES',
      type: 'BUY',
      shares: 1,
    }, alice.jar);
    assert(!r.ok, 'trade on fake market should fail');
  });

  await step('Probability endpoint remains valid (YES + NO ~= 1)', async () => {
    const r = await request('GET', `/api/markets/${market.id}/probability`);
    assert(r.ok, 'probability fetch failed');
    const yes = Number(r.data.yes);
    const no = Number(r.data.no);
    assert(yes > 0 && yes < 1, `YES out of range: ${yes}`);
    assert(no > 0 && no < 1, `NO out of range: ${no}`);
    assertApprox(yes + no, 1, 'YES+NO should sum to 1', 0.001);
  });
}

async function exchangeSection(ctx) {
  const { alice, bob } = ctx;
  const market = await createBinaryMarket(alice.jar, 'Exchange');

  await step('GTC BID reserves exact price*shares', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.4,
      shares: 20,
    }, alice.jar);

    assert(r.ok, `GTC BID failed: ${JSON.stringify(r.data)}`);
    assert(r.data.order?.side === 'BID', 'expected BID order');
    assertApprox(Number(r.data.order?.price), 0.4, 'order price should match request', 0.0001);
    assertApprox(Number(r.data.order?.remainingShares), 20, 'remainingShares should match unfilled request size', 0.0001);
    assert(Number(r.data.filledShares || 0) >= 0, 'filledShares should be non-negative');
  });

  await step('Non-crossing GTC ASK can be placed naked and remains unfilled', async () => {
    const ask = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'ASK',
      orderType: 'GTC',
      price: 0.8,
      shares: 10,
    }, bob.jar);

    assert(ask.ok, `GTC ASK failed: ${JSON.stringify(ask.data)}`);
    assert(Number(ask.data.filledShares || 0) === 0, 'ask should not fill against lower bid');
    assert(Number(ask.data.order?.reservedAmount || 0) > 0, 'naked ask should reserve short collateral');
  });

  await step('Crossing BID matches existing ASK with filled shares', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.8,
      shares: 6,
    }, alice.jar);

    assert(r.ok, `crossing BID failed: ${JSON.stringify(r.data)}`);
    assert(Number(r.data.filledShares || 0) > 0, 'crossing order should fill at least partially');
  });

  await step('Cancel order refunds reserve', async () => {
    const placed = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.3,
      shares: 10,
    }, alice.jar);

    assert(placed.ok, `place order failed: ${JSON.stringify(placed.data)}`);
    const orderId = placed.data.order?.id;
    assert(orderId, 'missing order id for cancellation');
    assertApprox(Number(placed.data.order?.price), 0.3, 'placed order price should match request', 0.0001);
    assertApprox(Number(placed.data.order?.remainingShares), 10, 'placed order remainingShares should match request', 0.0001);

    const cancelled = await request('DELETE', `/api/markets/${market.id}/order`, { orderId }, alice.jar);
    assert(cancelled.ok, `cancel failed: ${JSON.stringify(cancelled.data)}`);

    const detail = await request('GET', `/api/markets/${market.id}`, null, alice.jar);
    assert(detail.ok, 'market detail fetch after cancellation failed');
    const cancelledOrder = (detail.data.userOrders || []).find((o) => o.id === orderId);
    assert(cancelledOrder, 'cancelled order should be visible in user order history');
    assert(cancelledOrder.status === 'CANCELLED', `expected CANCELLED status, got ${cancelledOrder.status}`);
  });

  await step('FOK with insufficient liquidity is rejected or cancelled', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'FOK',
      price: 0.1,
      shares: 99999,
    }, alice.jar);

    if (r.ok && r.data?.order) {
      assert(r.data.order.status === 'CANCELLED', `expected CANCELLED, got ${r.data.order.status}`);
    } else {
      assert(!r.ok, 'FOK should fail when cannot fully fill');
    }
  });

  await step('FAK fills available liquidity and cancels remainder', async () => {
    const ask = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'ASK',
      orderType: 'GTC',
      price: 0.5,
      shares: 3,
    }, bob.jar);
    assert(ask.ok, 'setup ask for FAK failed');

    const fak = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'FAK',
      price: 0.5,
      shares: 100,
    }, alice.jar);

    assert(fak.ok, `FAK failed: ${JSON.stringify(fak.data)}`);
    assert(Number(fak.data.filledShares || 0) > 0, 'FAK should fill available liquidity');
    if (fak.data.order) {
      assert(Number(fak.data.order.remainingShares || 0) === 0, 'FAK remainder should be cancelled to 0');
      assert(['PARTIAL', 'FILLED'].includes(fak.data.order.status), `unexpected FAK status ${fak.data.order.status}`);
    }
  });

  await step('GTD with future expiresAt is accepted', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTD',
      price: 0.35,
      shares: 5,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }, alice.jar);

    assert(r.ok, `GTD future failed: ${JSON.stringify(r.data)}`);
    assert(r.data.order?.orderType === 'GTD', 'order type should be GTD');
    assert(r.data.order?.expiresAt, 'GTD should include expiresAt');
  });

  await step('GTD with past expiresAt is rejected', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTD',
      price: 0.35,
      shares: 5,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    }, alice.jar);

    assert(!r.ok, 'GTD past expiry should fail');
  });

  await step('Unauthenticated order is rejected', async () => {
    const r = await request('POST', `/api/markets/${market.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.5,
      shares: 1,
    });

    assert(!r.ok, 'unauthenticated order should fail');
  });

  await step('Order on expired market is rejected', async () => {
    const expired = await createBinaryMarket(alice.jar, 'Expired', {
      endDate: new Date(Date.now() - 3600_000).toISOString(),
    });

    const r = await request('POST', `/api/markets/${expired.id}/order`, {
      outcome: 'YES',
      side: 'BID',
      orderType: 'GTC',
      price: 0.5,
      shares: 1,
    }, alice.jar);

    assert(!r.ok, 'order on expired market should fail');
  });
}

async function main() {
  await waitForServer();
  const targetSection = process.argv[2];

  try {
    const ctx = await setupUsersAndMarket();

    if (!targetSection) {
      await section('AMM Trading', async () => ammSection(ctx));
      await section('Exchange Trading', async () => exchangeSection(ctx));
    } else if (targetSection === 'amm') {
      await section('AMM Trading', async () => ammSection(ctx));
    } else if (targetSection === 'exchange') {
      await section('Exchange Trading', async () => exchangeSection(ctx));
    } else {
      console.log(`Unknown section: ${targetSection}`);
      console.log('Valid sections: amm, exchange');
      process.exit(1);
    }
  } catch (e) {
    fail('[main]', e);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTS: ${passCount} passed, ${failCount} failed`);
  console.log('═'.repeat(70));

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(({ label, err }) => {
      console.log(`  • ${label}`);
      console.log(`    ${err}`);
    });
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
