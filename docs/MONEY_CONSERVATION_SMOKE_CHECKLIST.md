# Money Conservation Smoke Checklist (5–10 min pre-deploy)

Quick verification that the core conservation invariants haven't broken. Run this **before every deploy**.

**Prerequisites:**
```bash
docker start prediction-postgres
npm run db:reset  # Clean slate
npm run dev       # Start server
npm run test:conservation  # Run full suite first
```

If all 41 tests pass, you can skip to the manual spot-checks below. If any fail, debug first.

---

## Manual Spot-Checks (If Full Test Passed)

### 1. **Single Trade: Balance decrease = reported cost** (30 sec)

- Register user "smoke_a1_<time>".
- Create market.
- BUY 20 YES.
- Check `/api/auth/me` in DevTools console:
  ```javascript
  fetch('/api/auth/me').then(r => r.json()).then(d => console.log('balance:', d.balance))
  ```
- Verify balance is exactly `1000 - totalCost` from the trade response.

**Pass:** ✓ (Balance matches)

---

### 2. **Round-trip: Buy + sell same amount, error ≤ $0.01** (30 sec)

- Same user/market from #1 (or fresh if balance too low).
- BUY 30 YES → note cost (`totalCost`).
- SELL 30 YES → note proceeds (`totalCost`, should be negative).
- Check final balance.
- **Expected:** Start balance - (BUY cost + SELL proceeds) ≤ $0.01.

**Pass:** ✓ (Residual ≤ $0.01)

---

### 3. **Multi-user: Three traders, sum conserved** (1 min)

- Create one market.
- Register: "smoke_u1", "smoke_u2", "smoke_u3".
- User 1: BUY 20 YES (cost X₁).
- User 2: BUY 15 NO (cost X₂).
- User 3: BUY 30 YES (cost X₃).
- Check all three balances.
- **Verify:** `Σ(balance decreases) = X₁ + X₂ + X₃` to $0.002.

**Pass:** ✓ (Sum matches)

---

### 4. **Exchange: BID → cancel → refund** (45 sec)

- Register "smoke_exchange".
- Create market.
- Place BID: price=0.50, shares=20 → should reserve $10.00.
- Check balance decreased by $10.00.
- Cancel the order.
- Check balance returned to start (1000).

**Pass:** ✓ (Exact refund)

---

### 5. **Full lifecycle: Zero-trade → resolve → settle** (2 min)

- Register "smoke_settle".
- Create market with initialLiquidity=$150.
- **No trades** (skip all BUY/SELL).
- Wait for end (6+ sec or already elapsed).
- Vote to resolve.
- Check Portfolio for settled market.
- **Verify:** Creator balance = 1000 (fully recovered).

**Pass:** ✓ (Liquidity refunded)

---

### 6. **Dispute + re-resolve: Sum conserved** (2–3 min)

*(This is the most critical complex flow; B11 in automated test.)*

- Register: "smoke_d_creator", "smoke_d_alice", "smoke_d_bob" (all 1000).
- Creator: Create market (initialLiquidity=$100).
- Alice: BUY 30 YES (~$16).
- Bob: BUY 25 NO (~$11).
- **Check total balances:** ~2959 (1000×3 - $41 in trades).
- Creator: Vote YES → resolves YES.
- Bob: File dispute.
- Alice: Vote NO.
- Bob: Vote NO → market re-resolves NO.
- Check Portfolio for settled market.
- **Verify:** 
  - Bob (NO winner) balance ≈ 975 + 25 = 1000.
  - Alice (YES loser) balance ≈ 984 (no payout).
  - **Total:** 3000 (fully conserved) ✓

**Pass:** ✓ (Dispute settlement conserved)

---

## Summary Table

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Single BUY | balance ↓ = cost | ✓ |
| 2 | Buy+Sell | residual ≤ $0.01 | ✓ |
| 3 | Multi-user | Σ decreases = Σ costs | ✓ |
| 4 | BID cancel | exact refund | ✓ |
| 5 | Zero-trade settle | creator = 1000 | ✓ |
| 6 | Dispute system | total = 3000 | ✓ |

**All pass?** ✅ Safe to deploy.

**Any fail?** ❌ Debug before deploying.

---

## Debug Quick Links

If a test fails:

```bash
# Run full automated suite with verbose output
npm run test:conservation

# Run only API tests (fast)
npm run test:conservation:api

# Run only lifecycle tests (with DB)
npm run test:conservation:lifecycle

# Check a specific scenario (edit test file, add `scenario('only ...', ...)`)
# Or search for failing test name in test-money-conservation.js
```

---

## Deployment Gate

**Requirement:** All 41 conservation tests pass + manual spot-checks above pass.

**Command to verify before merge:**
```bash
npm run test:conservation && echo "✅ All 41 conservation tests passed!"
```

---

## Related Links

- Full checklist: `docs/MONEY_CONSERVATION_QA_CHECKLIST.md`
- Automated tests: `npm run test:conservation`
- Simulation smoke: `docs/MANUAL_QA_SMOKE_CHECKLIST.md`
