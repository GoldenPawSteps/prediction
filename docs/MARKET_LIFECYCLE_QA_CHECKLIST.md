# Market Lifecycle QA Checklist (Mapped to `test-market-lifecycle.js`)

This checklist mirrors the dedicated lifecycle simulation in `test-market-lifecycle.js`, but in human-executable steps.

Use this when you want to manually verify market state transitions end to end: `OPEN -> CLOSED -> RESOLVED/INVALID -> settled`, plus definitive admin resolution, short-settlement behavior, and the dispute latest-outcome path.

For a shorter pre-deploy pass, use `docs/MARKET_LIFECYCLE_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open the app at `http://localhost:3001`.
3. Keep DevTools open on the Network tab.
4. Use fresh users for each scenario.

Suggested users:
- Creator: `creator+lifecycle+<timestamp>@test.com`
- Trader A: `tradera+lifecycle+<timestamp>@test.com`
- Trader B: `traderb+lifecycle+<timestamp>@test.com`
- Password: `password123`

## 1. OPEN Creation And Expiry Auto-Close

### L1. Creation locks liquidity and appears as OPEN

1. Register Creator.
Expected:
- Account is created and logged in.
- Initial balance is 1000.

2. Create a market with:
- End date about 1 minute in the future
- Initial liquidity 120
- Any valid title, description, category, and resolution source

Expected:
- Market creation succeeds.
- Creator balance drops from 1000 to 880.
- Market appears in the markets list as `OPEN`.

3. Open the market detail page.
Expected:
- Status shows `OPEN`.
- Creator is visible.
- Market can still accept trades and orders.

4. Open the creator portfolio page.
Expected:
- `liquidityLocked` reflects 120 for the new market.

### L2. Expiry closes the market and refunds open reserves

1. Register Trader A.
2. While the market is still OPEN, place a GTC BID:
- Outcome: YES
- Price: 0.42
- Shares: 10

Expected:
- Order is accepted.
- Trader A balance decreases by exactly `0.42 * 10 = 4.20`.

3. Wait until the market end time passes.
4. Refresh the market detail page.
Expected:
- Market status changes to `CLOSED` automatically.

5. Open Trader A account/portfolio state and inspect the prior order.
Expected:
- The previously open BID is now `CANCELLED`.
- Trader A balance is fully refunded back to the pre-order amount.

6. Try to place a new AMM trade on the CLOSED market.
Expected:
- Trade is rejected.

7. Try to place a new order-book order on the CLOSED market.
Expected:
- Order is rejected.

## 2. Provisional Resolution And Immutable Finalization

### L3. Provisional resolution keeps positions and liquidity pending during dispute window

1. Register a fresh Creator and Trader A.
2. Create a market with:
- Initial liquidity 100
- Dispute window 1 hour
- End date about 1 minute in the future

3. Trader A buys 40 YES shares via AMM.
Expected:
- Trade succeeds.
- Trader A balance decreases.

4. Wait for expiry and refresh the market detail page.
Expected:
- Market status is `CLOSED`.

5. As Creator, resolve the market to YES.
Expected:
- Resolve succeeds.
- Response indicates settlement is pending.
- Market status becomes `RESOLVED`.
- Resolution shows YES.

6. Open Creator portfolio and Trader A portfolio immediately after resolution.
Expected:
- Creator `liquidityLocked` is still 100.
- Trader A still has an open position.
- Trader A does not yet receive the YES payout.

7. Try to trade on the RESOLVED market.
Expected:
- AMM trade is rejected.

8. Try to place a new order on the RESOLVED market.
Expected:
- Order is rejected.

### L4. Finalization unlocks liquidity, closes positions, and is idempotent

Manual note:
- In the automated simulation, finalization is forced by backdating `resolutionTime` in the database.
- In pure manual UI testing, you would either wait for the dispute window to elapse or use a DB helper.

1. Trigger immutable finalization after the dispute window is considered elapsed.
Expected:
- Portfolio or auth reads now finalize the market.

2. Refresh Creator portfolio.
Expected:
- `liquidityLocked` drops to 0.

3. Refresh Trader A portfolio.
Expected:
- Trader A open position count drops to 0.
- Trader A receives the YES payout for 40 shares.

4. Refresh the same portfolio pages again.
Expected:
- No second payout occurs.
- No extra creator refund occurs.
- Finalization behaves idempotently.

## 3. INVALID Lifecycle

### L5. INVALID remains pending first, then refunds cost basis on finalization

1. Register a fresh Creator and Trader A.
2. Create a market with:
- Initial liquidity 80
- Dispute window 1 hour
- End date about 1 minute in the future

3. Trader A buys 20 YES shares.
4. Wait for market expiry.
5. As Creator, resolve the market to INVALID.

Expected right after resolution:
- Market status is `INVALID`.
- Displayed probabilities are neutral: YES 0.5 and NO 0.5.
- Trader A balance is still reduced by the original buy cost.
- Trader A position is still open until finalization.

6. Trigger immutable finalization after dispute window expiry.
Expected:
- Creator `liquidityLocked` goes to 0.
- Trader A position closes.
- Trader A gets back the original cost basis for the INVALID position.

## 4. Dispute And Re-Resolution Lifecycle

### L6. Dispute changes provisional outcome, then finalization settles the latest outcome only

1. Register fresh users:
- Creator
- Trader A (YES side)
- Trader B (NO side)

2. Create a market with:
- Initial liquidity 100
- Dispute window 720 hours
- End date about 1 minute in the future

3. Before expiry:
- Trader A buys 30 YES
- Trader B buys 25 NO

Expected:
- Both trades succeed.
- Both balances decrease by their respective trade costs.

4. After expiry, Creator casts the first resolution vote: YES.
Expected:
- Because dispute count is 0, the first vote resolves immediately.
- Market becomes `RESOLVED` with provisional outcome YES.
- No payout is issued yet because settlement is still pending.

5. Trader B files a dispute proposing NO.
Expected:
- Dispute is accepted.
- Market status becomes `DISPUTED`.
- Dispute appears in the market detail view.
- Neither trader has been paid yet.

6. Trader A votes NO on the disputed market.
Expected:
- Market remains `DISPUTED` because dispute round 1 requires quorum 2.

7. Trader B votes NO.
Expected:
- Market re-resolves.
- Status returns to `RESOLVED`.
- Resolution changes from YES to NO.

8. Trigger immutable finalization after the dispute window is considered elapsed.
Expected:
- Trader A YES position closes without payout.
- Trader B NO position closes with a payout of 25 shares at $1 each.
- Creator liquidity is unlocked.
- Only the latest NO outcome is settled.

9. Refresh all related portfolio views again.
Expected:
- No duplicate payout or refund occurs on repeated reads.

## 5. Definitive Admin Resolution And Short Lifecycle

### L7. Admin resolve settles immediately and blocks disputes

1. Create a fresh market with at least one open order.
2. Resolve it from the admin page.
Expected:
- Market moves directly to settled state.
- Open orders are cancelled and refunded immediately.
- Trading and disputes are both blocked afterward.

### L8. Short lifecycle keeps collateral pending until finalization

1. Create a fresh market and open a short position by selling more shares than owned.
2. Resolve the market through the standard non-admin path.
Expected:
- Market is `RESOLVED`, but settlement is still pending.
- Short collateral stays locked.

3. Trigger immutable finalization.
Expected:
- Short position closes exactly once.
- Collateral is either released or consumed depending on the resolved outcome.

## Fast Failure Signals

Treat these as release blockers:

- OPEN market does not appear in list or detail view after creation
- Expired market remains tradeable
- Expired market fails to cancel open orders or refund BID reserves
- Provisional resolution pays out before dispute window closes
- Finalization fails to unlock creator liquidity
- Finalization duplicates payout/refund on repeated portfolio refreshes
- INVALID does not refund cost basis on finalization
- Definitive admin resolution leaves orders open or still allows dispute
- Short collateral disappears before finalization or settles twice
- Dispute fails to move market to DISPUTED or re-resolve with quorum
- Re-resolution settles the wrong final outcome

## Related Docs

- `test-market-lifecycle.js` - automated lifecycle simulation
- `docs/MARKET_LIFECYCLE_SMOKE_CHECKLIST.md` - short pre-deploy lifecycle pass
- `docs/MANUAL_TEST_SIMULATION.md` - overall simulation guide
