# Market Balance QA Checklist (Mapped to `test-market-balance.js`)

This checklist mirrors the dedicated balance simulation in `test-market-balance.js`, but in human-executable steps.

Use this when you want to manually verify wallet balance behavior across market funding, AMM trades, exchange reservation/refund/fill flows, and rejected operations.

For a shorter pre-deploy pass, use `docs/MARKET_BALANCE_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-db
npm run db:reset
npm run dev
```

2. Open the app at `http://localhost:3001`.
3. Keep DevTools open on the Network tab.
4. Use fresh users for each scenario.

Suggested users:
- Creator: `creator+balance+<timestamp>@test.com`
- Trader: `trader+balance+<timestamp>@test.com`
- Buyer: `buyer+balance+<timestamp>@test.com`
- Seller: `seller+balance+<timestamp>@test.com`
- Password: `password123`

## 1. Wallet Baseline

1. Register a fresh user.
2. Fetch `/api/auth/me`.
Expected:
- User has positive starting balance.

3. Fetch `/api/portfolio` as the same user.
Expected:
- `stats.availableBalance` matches `/api/auth/me` balance.

4. Call `/api/auth/me` and `/api/portfolio` without auth.
Expected:
- Both return auth error (unauthorized).

## 2. Market Funding Debit

1. Register a fresh creator.
2. Capture creator balance.
3. Create a binary market with `initialLiquidity = 135`.
Expected:
- Creator balance decreases by exactly `135`.
- Portfolio `stats.liquidityLocked` includes `135`.

## 3. AMM Balance Movement

1. Create a market and use a trader account.
2. Perform AMM BUY YES (example: 20 shares).
Expected:
- BUY response returns positive `trade.totalCost`.
- Trader balance decreases by exact `trade.totalCost`.

3. Perform AMM SELL YES (example: 8 shares).
Expected:
- SELL response returns negative `trade.totalCost`.
- Trader balance increases by `abs(trade.totalCost)`.

## 4. Exchange Reservation And Refund

1. Use buyer account and place GTC BID (example: `price=0.42`, `shares=10`).
Expected:
- Buyer balance decreases by exactly `price × shares` (`4.2`).

2. Cancel the same order.
Expected:
- Buyer balance returns to the exact pre-order level.

## 5. Exchange Fill Transfer

1. Give seller inventory by AMM BUY YES.
2. Record combined balances of buyer + seller.
3. Place seller ASK and matching buyer BID at same price/shares (example: `0.55 × 6`).
Expected:
- Fill occurs (`filledShares > 0`).
- Buyer balance decreases by the matched amount (`3.3` in example).
- Combined buyer + seller balances remain unchanged (no money created/destroyed by fill).

## 6. Rejected Operations Do Not Mutate Balance

1. Attempt oversized AMM BUY that should be rejected.
Expected:
- Request fails.
- Trader balance remains unchanged.

2. Attempt invalid order payload (example: BID with price > 1).
Expected:
- Request fails.
- Trader balance remains unchanged.

## Fast Failure Signals

Treat as release blockers if any occur:

- `/api/auth/me` and portfolio available-balance diverge
- Market creation debit differs from configured initial liquidity
- AMM BUY/SELL deltas do not match `trade.totalCost`
- BID reserve debit differs from `price × shares`
- Cancel does not fully refund reserved BID amount
- Matching fills create/destroy net money across participants
- Rejected operations mutate balances

## Suggested Timing

- Target duration: 12-18 minutes
- Run on every release candidate touching wallet accounting, trade costs, order reservation/refund, or mutation validation paths

## Related Docs

- `docs/MARKET_BALANCE_SMOKE_CHECKLIST.md` - short pre-deploy balance pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-balance.js` - automated balance simulation