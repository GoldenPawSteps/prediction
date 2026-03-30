# Market Portfolio Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated portfolio simulation.

It focuses on the highest-risk portfolio paths:
- authenticated baseline payload shape
- position valuation and stats coherence
- BID reserve tracking in `reservedOrders` and `stats`
- created-market liquidity lock visibility
- AMM vs EXCHANGE trade classification

## Setup

1. Ensure services are running:

```bash
docker start prediction-db
npm run db:reset
npm run dev
```

2. Open `http://localhost:3001`.
3. Keep DevTools Network tab open.
4. Prefer running the automated suite first:

```bash
npm run test:portfolio
```

Expected:
- `RESULTS: 7 passed, 0 failed`

## 6-Step Smoke Flow

1. Authenticate a fresh user and call `/api/portfolio`.
Expected: baseline arrays/stats are present and empty for new account.

2. Call `/api/portfolio` unauthenticated.
Expected: returns `401`.

3. Create market and execute AMM buys as trader.
Expected: trader portfolio shows positions with `currentPrice`, `currentValue`, and `unrealizedPnl`; stats totals are coherent.

4. Place open BID order (for example `0.40 × 10`).
Expected: balance drops by reserve amount, order appears in `reservedOrders`, and `stats.reservedBalance` matches reserved sum.

5. Create two open markets as creator (for example liquidity `90` and `110`).
Expected: both appear in `createdMarkets`; `stats.liquidityLocked` equals `200`.

6. Execute maker/taker exchange fill after maker inventory seeding.
Expected: portfolio trades classify correctly as `AMM` vs `EXCHANGE` and roles as `MAKER`/`TAKER`.

## Fast Failure Signals

- Authenticated portfolio response missing expected arrays/stats
- Unauthenticated portfolio call does not return `401`
- Position valuation fields missing or inconsistent with stats totals
- Reserved BID amount not reflected in `reservedOrders` and `stats.reservedBalance`
- Created market liquidity not reflected in `stats.liquidityLocked`
- Exchange fills missing `EXCHANGE` classification or wrong maker/taker role

## Suggested Timing

- Target duration: 7-10 minutes
- Run on each release candidate touching portfolio, order reservation, or exchange fill processing

## Related Docs

- `docs/MARKET_PORTFOLIO_QA_CHECKLIST.md` - full manual portfolio checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-portfolio.js` - automated portfolio simulation