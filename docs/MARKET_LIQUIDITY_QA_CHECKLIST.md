# Market Liquidity QA Checklist (Mapped to `test-market-liquidity.js`)

This checklist mirrors the dedicated liquidity simulation in `test-market-liquidity.js`, but in human-executable steps.

Use this when you want to manually verify creator funding locks, portfolio liquidity accounting, liquidity-sensitive price impact, multi-outcome liquidity aggregation, and immutable liquidity unlock behavior after finalization.

For a shorter pre-deploy pass, use `docs/MARKET_LIQUIDITY_SMOKE_CHECKLIST.md`.

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
- Creator: `creator+liquidity+<timestamp>@test.com`
- Trader: `trader+liquidity+<timestamp>@test.com`
- Password: `password123`

## 1. Binary Liquidity Lock On Creation

1. Register a fresh creator.
2. Capture creator balance from `/api/auth/me`.
3. Create a binary market with:
- Initial liquidity: 120
- Prior probability: 65%

Expected:
- Market creation succeeds.
- Creator balance decreases by exactly 120.
- Portfolio `availableBalance` matches `/api/auth/me`.
- Portfolio `liquidityLocked` shows 120.
- Created market appears in `createdMarkets`.

4. Fetch market detail.
Expected:
- `initialLiquidity` is 120.
- `liquidityParam` is a positive number.

## 2. Liquidity Sensitivity (Price Impact)

1. Register fresh creator and trader.
2. Create two binary markets with identical priors (50%) but different funding:
- Low-liquidity market: 40
- High-liquidity market: 400

3. Fetch both market details.
Expected:
- High-liquidity market has higher `liquidityParam` than low-liquidity market.

4. On both markets, perform the same trade from the trader account:
- BUY YES 10 shares

Expected:
- YES probability increases on both markets.
- The low-liquidity market moves more in probability than the high-liquidity market.
- The same trade costs more on the low-liquidity market than on the high-liquidity market.

## 3. Multi-Outcome Liquidity Aggregation

1. Register a fresh creator.
2. Create a MULTI market with three outcomes:
- Alpha: initial liquidity 50
- Beta: initial liquidity 150
- Gamma: initial liquidity 300

3. Capture creator balance before and after creation.
Expected:
- Balance decreases by exactly 500 (sum of child liquidities).
- Portfolio `liquidityLocked` is 500.

4. Fetch parent market detail.
Expected:
- Parent market type is `MULTI`.
- Parent `initialLiquidity` is 500.
- Exactly three child outcomes are present.

5. Inspect child liquidity characteristics.
Expected:
- Child liquidity params increase with child funding (Gamma > Beta > Alpha).
- Child market records preserve configured funding amounts.

## 4. Provisional Resolution Keeps Liquidity Locked

1. Register a fresh creator.
2. Create a short-expiry binary market with initial liquidity 140.
3. Confirm before resolution:
- `liquidityLocked` includes the 140.

4. Wait for expiry and resolve market YES.
Expected:
- Resolve response indicates settlement is pending.
- Portfolio still reports 140 liquidity locked.

## 5. Immutable Finalization Unlocks Liquidity Exactly Once

Manual note:
- In automated simulation, finalization is triggered by backdating `resolutionTime` in DB.
- In pure manual testing, either wait for dispute-window expiry or use a DB helper.

1. Trigger immutable finalization after dispute-window expiry.
Expected:
- Creator `liquidityLocked` drops to zero.
- Creator balance returns to pre-market level for zero-trade market.

2. Trigger the same finalization path again (refresh portfolio/detail).
Expected:
- No second liquidity refund occurs.
- Balance remains unchanged.

## Fast Failure Signals

Treat as release blockers if any occur:

- Creator balance debit does not match configured initial liquidity
- Portfolio `liquidityLocked` does not match funded open markets
- Higher funded markets do not show higher `liquidityParam`
- Same-size trade causes larger move in high-liquidity market than low-liquidity market
- Multi parent liquidity does not equal sum of child liquidities
- Liquidity unlocks before immutable finalization
- Finalization can unlock/refund liquidity more than once

## Suggested Timing

- Target duration: 12-18 minutes
- Run on every release candidate touching market creation funding, portfolio accounting, LMSR liquidity math, resolution/finalization, or multi-outcome shaping

## Related Docs

- `docs/MARKET_LIQUIDITY_SMOKE_CHECKLIST.md` - short pre-deploy liquidity pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-liquidity.js` - automated liquidity simulation