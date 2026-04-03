# Market Trading QA Checklist (Mapped to `test-market-trading.js`)

This checklist mirrors the dedicated trading simulation in `test-market-trading.js`, but in human-executable steps.

Use this to manually verify AMM and order-book behavior: long and short trade execution, probability movement, matching, cancellation, time-in-force rules, and rejection paths.

For a shorter pre-deploy pass, use `docs/MARKET_TRADING_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open app at `http://localhost:3001`.
3. Keep DevTools open on Network tab.
4. Use fresh users for each run.

Suggested users:
- Trader A: `tradera+trading+<timestamp>@test.com`
- Trader B: `traderb+trading+<timestamp>@test.com`
- Password: `password123`

## 1. Auth And Trading Setup

1. Register Trader A and Trader B.
Expected:
- Both registrations succeed.
- Sessions are independent.

2. As Trader A, create a valid binary market for testing.
Expected:
- `POST /api/markets` returns `201`.
- Market is visible and open.

## 2. AMM Trading Flow

1. Trader A buys YES shares.
Expected:
- Trade succeeds.
- `trade.totalCost` is positive.
- YES probability increases.

2. Trader B buys NO shares.
Expected:
- Trade succeeds.
- `trade.totalCost` is positive.
- NO probability increases relative to pre-trade value.

3. Trader A sells a portion of YES shares.
Expected:
- Trade succeeds.
- `trade.totalCost` is negative (proceeds).

4. Attempt over-sell (sell more shares than owned) on a funded account.
Expected:
- Trade succeeds and opens short exposure.
- Position `shares` can go negative.
- Portfolio reserved balance increases via short collateral.

5. Attempt the same over-sell on an underfunded account.
Expected:
- Rejected for insufficient collateral.

6. Attempt oversized buy that exceeds funds.
Expected:
- Rejected.

7. Attempt unauthenticated trade request.
Expected:
- Rejected.

8. Attempt trade on non-existent market id.
Expected:
- Rejected.

9. Verify probability endpoint.
Expected:
- YES and NO are in `(0, 1)`.
- YES + NO is approximately `1`.

## 3. Exchange Order-Book Flow

1. Place GTC BID (for example YES @ 0.40, shares 20).
Expected:
- Order accepted as open/partial.
- Order fields match request.

2. Place non-crossing GTC ASK (for example YES @ 0.80) from Trader B, with or without inventory.
Expected:
- Order accepted.
- No immediate fill.
- If Trader B lacks inventory, ASK still opens as a naked short order and locks collateral immediately.

3. Place crossing BID (for example YES @ 0.80).
Expected:
- Immediate fill occurs (`filledShares > 0`).
- Buyer payment increases the seller's short collateral rather than causing an extra available-balance debit.

4. Place another BID and cancel it.
Expected:
- Cancel succeeds.
- Order appears in user order history with `CANCELLED` status.

5. Place FOK with insufficient liquidity.
Expected:
- Rejected or returned as cancelled.

6. Place FAK larger than available liquidity at target price.
Expected:
- Partial immediate fill for available size.
- Unfilled remainder cancelled.

7. Place GTD with future `expiresAt`.
Expected:
- Accepted with `GTD` and persisted expiry.

8. Place GTD with past `expiresAt`.
Expected:
- Rejected.

9. Attempt unauthenticated order placement.
Expected:
- Rejected.

10. Attempt order on expired market.
Expected:
- Rejected.

## Fast Failure Signals

Treat as release blockers if any occur:

- Funded oversells fail to open short exposure, or undercollateralized oversells succeed
- Probability endpoint returns invalid values
- Crossing orders fail to match
- Naked ASK orders do not reserve collateral correctly
- Cancelled orders do not show `CANCELLED`
- FOK/FAK/GTD constraints are not enforced
- Trading/order actions succeed without authentication

## Suggested Timing

- Target duration: 12-20 minutes
- Run on each release candidate touching AMM/order-book/trade validation logic

## Related Docs

- `docs/MARKET_TRADING_SMOKE_CHECKLIST.md` - short pre-deploy trading pass
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation and testing guide
- `test-market-trading.js` - automated trading simulation
