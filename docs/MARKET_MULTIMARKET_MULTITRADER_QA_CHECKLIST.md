# Market MultiMarket MultiTrader QA Checklist (Mapped to `test-multimarket-multitrader.js`)

This checklist mirrors the dedicated multi-market multi-trader simulation in `test-multimarket-multitrader.js`, but in human-executable steps.

Use this when you want to manually verify concurrent user behavior across multiple markets, mixed AMM/exchange flows, and cross-market portfolio and leaderboard consistency.

For a shorter pre-deploy pass, use `docs/MARKET_MULTIMARKET_MULTITRADER_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-db
npm run db:reset
npm run dev
```

2. Open the app at `http://localhost:3001`.
3. Keep DevTools open on the Network tab.
4. Use fresh users for this scenario.

Suggested users:
- Creator: `creator+mmmt+<timestamp>@test.com`
- Trader A: `tradera+mmmt+<timestamp>@test.com`
- Trader B: `traderb+mmmt+<timestamp>@test.com`
- Trader C: `traderc+mmmt+<timestamp>@test.com`
- Password: `password123`

## 1. Scenario Setup

1. Register creator and three traders.
2. Verify each account starts with positive balance.
3. Create:
- two binary markets with different priors/liquidity
- one multi-outcome parent market with three outcomes

Expected:
- All users authenticate successfully.
- Market creation succeeds for all three markets.
- Multi parent exposes three child outcome markets.

## 2. AMM Matrix Across Markets

1. Execute AMM trades from multiple traders across:
- binary market A
- binary market B
- all three child outcome markets

2. Include at least one SELL after BUY on one market.

Expected:
- All trades succeed.
- Probabilities remain valid and normalized on each active binary/child market.
- Market volumes increase on all touched markets.

## 3. Exchange Matrix Across Traders

1. Seed seller inventory on one binary market via AMM BUY.
2. Place ASK from one trader.
3. Place crossing BID from another trader.
4. Place and cancel a separate reserve-only BID on another market.

Expected:
- Crossing orders fill (`filledShares > 0`).
- Reserve BID debits by exact `price × shares`.
- Cancel fully refunds that reserve.

## 4. Cross-Market Validation

1. Fetch market details for all active markets.
Expected:
- Each active market shows positive volume.
- Binary probabilities stay coherent (`yes + no ~= 1`).
- Multi parent still exposes all outcomes.

2. Fetch portfolio for each trader.
Expected:
- Each trader has non-empty trade history.
- Portfolio stats include numeric `totalValue` and `availableBalance`.

3. Fetch creator portfolio.
Expected:
- All created markets appear in `createdMarkets`.
- `liquidityLocked` remains positive while markets are unresolved.

4. Fetch leaderboard with `sortBy=trades`.
Expected:
- Entries stay sorted descending by `totalTrades` during active multi-trader load.

## Fast Failure Signals

Treat as release blockers if any occur:

- Multi parent does not expose expected child markets
- Cross-market AMM activity breaks probability normalization
- Crossing exchange orders fail to match despite crossing prices
- Reserve BID debit/refund are not exact
- Trader portfolios fail to reflect their activity across markets
- Creator created-markets tracking is incomplete
- Trades leaderboard loses descending order under concurrent multi-user activity

## Suggested Timing

- Target duration: 15-25 minutes
- Run on every release candidate touching matching engine, AMM logic, portfolio shaping, multi-outcome markets, or leaderboard ranking

## Related Docs

- `docs/MARKET_MULTIMARKET_MULTITRADER_SMOKE_CHECKLIST.md` - short pre-deploy multimarket pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-multimarket-multitrader.js` - automated multimarket simulation