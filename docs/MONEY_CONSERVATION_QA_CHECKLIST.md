# Manual Money Conservation QA Checklist (Mapped to `test-money-conservation.js`)

This checklist maps the automated money conservation tests to manual verification steps. Most tests are API-verification focused (checking exact balance changes), so this guide shows you what to look for and how to verify the key invariants using the UI and browser DevTools.

**For a faster pre-deploy run**, use `docs/MONEY_CONSERVATION_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:
```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open app at `http://localhost:3001`.
3. **Keep DevTools open** (Network + Console tabs throughout).
4. Use fresh users for each scenario to avoid collisions.

**Pro tip:** Paste this into console to log all balance changes:
```javascript
let lastBalance = null
setInterval(async () => {
  const res = await fetch('/api/auth/me')
  const data = await res.json()
  if (data.balance && lastBalance !== null && data.balance !== lastBalance) {
    console.log(`Balance changed: ${lastBalance} → ${data.balance} (Δ${(data.balance - lastBalance).toFixed(6)})`)
  }
  lastBalance = data.balance
}, 1000)
```

---

## PART A: API-Level Invariants (No Settlement)

These tests verify that each trade operation conserves money at the transaction level.

### **A1 – AMM BUY: Balance decreases by exactly totalCost**

**Setup:**
1. Register user "a1_conservation_<timestamp>".
2. Create a market (any title, "Technology" category).
3. Note starting balance (should be 1000).

**Manual steps:**
1. Open DevTools → Network tab.
2. In UI, go to market detail page.
3. Click "BUY" on the YES side, enter 30 shares, submit.
4. In Network tab, find the `/api/markets/.../trade` POST request.
5. In Response, note `trade.totalCost` (e.g., `15.234567`).
6. Go to Profile page (or check `/api/auth/me` in console).
7. New balance should be `1000 - 15.234567 ≈ 984.765433`.

**Verify:**
- Balance decrease matches reported `totalCost` (to $0.001).
- Repeat with a second BUY on the NO side — same invariant holds.

**Why:** Proves the backend accurately tracks what money left the account.

---

### **A2 – AMM SELL: Balance increases by exactly proceeds**

**Setup:**
1. Use same market/user from A1.
2. User has 30 YES shares (from the BUY in A1).

**Manual steps:**
1. Network tab ready.
2. In UI, click "SELL" on YES, enter 15 shares, submit.
3. Check `/api/markets/.../trade` POST response → note `trade.totalCost` (should be negative, e.g., `-7.234567`).
4. Check new balance in Profile → should increase by 7.234567.

**Verify:**
- `Balance increase = |totalCost|` to $0.001 precision.

**Why:** Ensures sellers receive exact proceeds without leaks.

---

### **A3 – Round-trip: Buy 25, sell 25, net ≤ $0.01**

**Setup:**
1. Same market/user, new fresh user if balance too low.
2. Note balance before (e.g., `950.000000`).

**Manual steps:**
1. BUY 25 YES → note `totalCost` (e.g., `12.345`).
2. SELL 25 YES → note proceeds (e.g., `-12.335`).
3. Sum: `12.345 + (-12.335) = 0.010` (net residual $0.01).
4. Check final balance → should be `950 - 0.010 ≈ 949.990`.

**Verify:**
- Net of roundtrip ≤ $0.01.
- Actual balance matches.

**Why:** Proves LMSR pricing is path-consistent (no hidden slippage).

---

### **A4 – Multi-user sum: Σ(decreases) = Σ(costs)**

**Setup:**
1. Create one market.
2. Register three users: "a4u1", "a4u2", "a4u3".

**Manual steps:**
1. Each user starts at balance 1000.
2. User 1 BUYs 20 YES → note cost (e.g., `10.5`).
3. User 2 BUYs 15 NO → note cost (e.g., `7.2`).
4. User 3 BUYs 30 YES → note cost (e.g., `20.1`).
5. Sum of all three costs: `10.5 + 7.2 + 20.1 = 37.8`.
6. Check final balances:
   - User 1: `1000 - 10.5 = 989.5`.
   - User 2: `1000 - 7.2 = 992.8`.
   - User 3: `1000 - 20.1 = 979.9`.
7. Total balances: `989.5 + 992.8 + 979.9 = 2962.2`.
8. Started with: `1000×3 = 3000`.
9. Sum decreased by: `3000 - 2962.2 = 37.8` ✓ (matches total costs).

**Verify:**
- Σ(balance decreases) = Σ(reported costs) to $0.002.

**Why:** Proves no money is created/destroyed in multi-user trades.

---

### **A5 – Exchange BID: Reserve = price × shares**

**Setup:**
1. One market, one user "a5".
2. Note starting balance (1000).

**Manual steps:**
1. In UI, go to "Exchange" tab for the market.
2. Place a BID order: price=0.45, shares=20.
3. Expected reserve: `0.45 × 20 = 9.00`.
4. Check balance → should be `1000 - 9.00 = 991.00`.
5. In DevTools, verify the `/api/markets/.../order` POST response shows `order.price = 0.45` and `order.remainingShares = 20`.

**Verify:**
- Balance decreases by exactly `price × shares`.
- Order response confirms values.

**Why:** Ensures limit orders reserve the correct amount upfront.

---

### **A6 – Exchange BID cancel: Full refund**

**Setup:**
1. Same market/user from A5 (or fresh user).
2. Place a BID: price=0.40, shares=15 → reserves $6.00.
3. Balance after: `1000 - 6 = 994` (or whatever post-place).

**Manual steps:**
1. In UI, find the open order and click "Cancel".
2. Check balance → should return to 1000 exactly.
3. Repeat with a second, larger order (price=0.60, shares=10) → cancel.
4. Check balance again → should restore fully.

**Verify:**
- Each cancel fully refunds the reserved amount (to $0.001).

**Why:** Proves cancelled orders don't leak money.

---

### **A7 – Exchange fill: Buyer pays X, seller receives X**

**Setup:**
1. Two users: buyer "a7buyer", seller "a7seller".
2. Market with seller who owns 30 YES shares (from prior AMM BUY).

**Manual steps:**
1. **Buyer:** Place BID at $0.55 for 10 YES → reserves $5.50.
   - Check buyer balance decreases by $5.50.
2. **Seller:** Place ASK at $0.55 for 10 YES.
   - Should match and partially fill the BID.
3. Check both post-fill balances:
   - Seller balance should increase by $5.50 (payment from fill).
   - Buyer's reserved amount remains locked (shares now in position).
4. Verify combined buyer+seller balance hasn't changed (money transferred, not created).

**Verify:**
- Seller increase = buyer payment to $0.01.
- Combined balance unchanged.

**Why:** Proves exchange fills are zero-sum (no money created).

---

## PART B: Full Lifecycle Invariants (With Settlement)

These tests verify money conservation across entire market lifecycles, including resolution and settlement.

### **B8 – Zero-trade market: Creator recovers liquidity**

**Setup:**
1. User "b8creator" starts at 1000.
2. Create market with initialLiquidity = $150.

**Manual steps:**
1. Check balance after create → should be `1000 - 150 = 850`.
2. **Do not trade on this market** (leave NO side, YES side untouched).
3. Go back to market detail after market end time (wait 6+ seconds or refresh if already elapsed).
4. As creator, click "Resolve Market" → vote YES.
5. Go to Profile → check for "recentlySettledMarkets".
6. Creator balance should be **exactly 1000** again.

**Verify:**
- Balance return to start (1000) after zero settlement.

**Why:** Shows market creator doesn't lose money if no one trades.

---

### **B9 – Single-sided YES market: Only YES buyers, resolved YES**

**Setup:**
1. Three users: "b9_creator", "b9_alice", "b9_bob".
2. Creator: balance 1000 → creates market (initialLiquidity $100) → balance 900.
3. Alice starts at 1000, Bob starts at 1000.

**Manual steps:**
1. **Alice:** BUY 30 YES in the market → costs ~$16 → balance ~984.
2. **Bob:** BUY 20 YES in the market → costs ~$11 → balance ~989.
3. (No one buys NO side.)
4. Wait for market end.
5. **Creator:** Vote YES → market resolves YES.
6. Go to Portfolio → check "recently settled markets".
7. **Alice:** Balance should now be ~`984 + 30 = 1014` (+30 YES payout).
8. **Bob:** Balance should now be ~`989 + 20 = 1009` (+20 NO payout).
9. **Creator:** Should recover their $100 + residual from overall pool.
10. **Total system balance:** All three combined should be **exactly 3000** (start sum).

**Verify:**
- Each winner receives their share payout (price $1.00).
- System total = 3000 (conserved).

**Why:** Proves single-sided markets settle correctly.

---

### **B10 – Creator as trader: Dual payout (shares + residual)**

**Setup:**
1. User "b10_creator" (1000) and "b10_alice" (1000).
2. Creator creates market (initialLiquidity $100) → balance 900.

**Manual steps:**
1. **Creator:** BUY 25 YES (spending ~$12) → balance ~888.
2. **Alice:** BUY 20 NO (spending ~$8) → balance ~992.
3. Wait for market end.
4. **Creator:** Vote YES → resolves YES.
5. Go to Portfolio → check settled markets.
6. **Creator:** Balance should be **> 900** (not just their $100 back, but also their 25 YES shares × $1.00 payout + residual).
7. **Alice:** Balance should be ~`992` (losing NO side gets nothing; loses their $8 trade cost).
8. **Combined:** Should sum to 1000 + 1000 = 2000.

**Verify:**
- Creator receives (YES winner payout) + (creator refund residual).
- Alice (loser) doesn't receive anything.
- Total conserved to $0.02.

**Why:** Tests complex scenario where creator has dual roles.

---

### **B11 – Dispute rollback: Conservation across dispute + re-resolve**

**Setup:**
1. Three users: "b11_creator" (1000), "b11_alice" (1000), "b11_bob" (1000).
2. Creator creates market with `disputeWindowHours: 720` (30 days) → (initialLiquidity $100).

**Manual steps:**

#### Phase 1: Trading
1. **Alice:** BUY 30 YES → balance drops to ~984.
2. **Bob:** BUY 25 NO → balance drops to ~975.
3. **Current total:** ~2959 (includes creator's 900 + alice's 984 + bob's 975).

#### Phase 2: Initial resolution
1. Wait for market end (6+ sec or refresh if visible).
2. **Creator:** Vote YES → market resolves YES.
3. Check **creator** balance → should be ~900 (no payout yet; in dispute window).
4. Check **alice** balance → should still be ~984 (no payout locked in; settlement pending).
5. **Total should still be ~2959.**

#### Phase 3: Dispute filed
1. **Bob:** Go to market → click "Dispute" button.
2. Fill in reason (min 20 chars) and select "NO" as proposed outcome.
3. Submit dispute.
4. Check market status → should show "DISPUTED".
5. Check all three balances → should still be ~2959 (no change).

#### Phase 4: Re-vote
1. **Alice:** Vote NO (on the disputed market).
2. Market should not resolve yet (quorum 1 vote, but need 2 for dispute round).
3. **Bob:** Vote NO.
4. Market should resolve NO immediately.
5. Check market status → should show "RESOLVED NO".

#### Phase 5: Settlement
1. **(For this step, the test would normally backdate the DB. In manual testing, you'd need to wait ~30 days or use test utilities. For now, note this would happen automatically after 720h.)**
2. Go to Portfolio page (or refresh).
3. Check "recently settled markets" for this market.
4. **Bob** (NO winner): Balance should now be ~`975 + 25 = 1000` (+25 NO payout).
5. **Alice** (YES loser): Balance should be ~984 (no payout; lost).
6. **Creator:** Should receive residual refund from the pool.
7. **Total system:** Should be exactly **3000** ✓.

**Verify:**
- Phase 2: No settlement yet (in dispute window).
- Phase 3: Dispute doesn't change balances.
- Phase 4: Market re-resolves correctly.
- Phase 5: Settlement applies new resolution, old YES payout reversed, new NO payout applied.
- Total conserved through **all phases**.

**Why:** Most complex scenario; proves the system can handle market disputes without losing money.

---

### **B12 – Precision drift: 20 micro-trades, error ≤ $0.02**

**Setup:**
1. User "b12_trader" (1000).
2. One market.

**Manual steps:**
1. Note starting balance: 1000.
2. Perform 10 rounds of: BUY 1 YES, SELL 1 YES (20 trades total).
   - Each BUY: note the cost (e.g., 0.50).
   - Each SELL: note the proceeds (e.g., -0.49).
3. After each pair, note cumulative net (should stay near $0).
4. After all 20 trades, check final balance → should be **≤ $0.02 away from 1000**.

**Example:**
```
BUY 1:   cost=0.50,  balance=999.50
SELL 1:  proceeds=-0.49, balance=999.99  (net=-0.01)
BUY 1:   cost=0.50,  balance=999.49
SELL 1:  proceeds=-0.49, balance=999.98  (net=-0.01)
...after 20 trades, balance should be 999.98 to 1000.02
```

**Verify:**
- Cumulative error < $0.02 after 20 trades.

**Why:** Ensures floating-point rounding doesn't accumulate over many micro-trades.

---

## Checklist Summary

- [ ] **A1:** BUY: balance decrease = totalCost ✓
- [ ] **A2:** SELL: balance increase = proceeds ✓
- [ ] **A3:** Round-trip: net ≤ $0.01 ✓
- [ ] **A4:** Multi-user: Σ(decreases) = Σ(costs) ✓
- [ ] **A5:** BID: reserve = price × shares ✓
- [ ] **A6:** Cancel: full refund ✓
- [ ] **A7:** Fill: buyer pays = seller receives ✓
- [ ] **B8:** Zero-trade: creator recovers full $100 ✓
- [ ] **B9:** Single-sided: YES buyers, resolved YES, conserved ✓
- [ ] **B10:** Creator as trader: dual payout, conserved ✓
- [ ] **B11:** Dispute+re-resolve: conserved all phases ✓
- [ ] **B12:** 20 micro-trades: error < $0.02 ✓

---

## Tips for Manual Testing

1. **Use timestamps in usernames** to ensure uniqueness across runs.
2. **Keep a calculator or spreadsheet** to track expected vs. actual balances.
3. **Screenshot key moments** (before/after trades, after settlement) for documentation.
4. **Check Network tab** for any 4xx/5xx errors on trade/order endpoints.
5. **Test in isolation:** Run one scenario per market to avoid confusion.

---

## Related Docs

- Automated tests: `npm run test:conservation`
- Simulation guide: `docs/MANUAL_TEST_SIMULATION.md`
- Smoke checklist: `docs/MONEY_CONSERVATION_SMOKE_CHECKLIST.md`
