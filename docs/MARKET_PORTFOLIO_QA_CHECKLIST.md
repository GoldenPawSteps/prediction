# Market Portfolio QA Checklist (Mapped to `test-market-portfolio.js`)

This checklist mirrors the dedicated portfolio simulation in `test-market-portfolio.js`, but in human-executable steps.

Use this when you want to manually verify portfolio endpoint shape, valuation math, reserved-order accounting, created-market liquidity tracking, and trade execution classification.

For a shorter pre-deploy pass, use `docs/MARKET_PORTFOLIO_SMOKE_CHECKLIST.md`.

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
- Creator: `creator+portfolio+<timestamp>@test.com`
- Trader: `trader+portfolio+<timestamp>@test.com`
- Maker: `maker+portfolio+<timestamp>@test.com`
- Taker: `taker+portfolio+<timestamp>@test.com`
- Password: `password123`

## 1. Portfolio Baseline And Auth

1. Register a fresh user.
2. Call `/api/portfolio` while authenticated.
Expected:
- Response contains `positions`, `trades`, `reservedOrders`, `createdMarkets`, and `stats`.
- Fresh account has empty arrays.
- `stats.availableBalance` matches `/api/auth/me` balance.
- `stats.reservedBalance` is `0`.
- `stats.liquidityLocked` is `0`.
- `stats.totalPositions` is `0`.

3. Call `/api/portfolio` without auth.
Expected:
- API returns `401`.

## 2. Position Valuation And Stats Integrity

1. Create a binary market as creator.
2. As trader, place at least two AMM buys (for example YES and NO buys).
3. Call `/api/portfolio` for trader.
Expected:
- At least one open position appears.
- Position includes `shares`, `avgEntryPrice`, `currentPrice`, `currentValue`, `unrealizedPnl`.
- Per-position math is consistent:
  - `currentValue ≈ shares × currentPrice`
  - `unrealizedPnl ≈ currentValue - (shares × avgEntryPrice)`

4. Verify aggregate stats in the same response.
Expected:
- `stats.totalPositions` equals `positions.length`.
- `stats.totalValue` equals sum of `positions.currentValue`.
- `stats.totalUnrealizedPnl` equals sum of `positions.unrealizedPnl`.
- `stats.totalRealizedPnl` equals sum of `positions.realizedPnl`.

## 3. Reserved Order Accounting

1. Create a binary market.
2. As trader, place open BID order (example: price `0.40`, shares `10`).
3. Compare trader balance before/after order placement.
Expected:
- Balance decreases by exactly `price × shares` (`4.00` in this example).

4. Call `/api/portfolio` for trader.
Expected:
- Order appears in `reservedOrders` with market metadata.
- `stats.reservedBalance` equals sum of `reservedOrders.reservedAmount`.
- For a single open BID, reserved balance equals that order's reserved amount.

## 4. Created Markets And Liquidity Lock

1. As creator, create two open binary markets with initial liquidity `90` and `110`.
2. Call `/api/portfolio` for creator.
Expected:
- Both markets appear in `createdMarkets`.
- `stats.liquidityLocked` equals `200`.
- `stats.liquidityLocked` equals sum of `createdMarkets.initialLiquidity`.
- Creator balance decrease equals the funded liquidity total (`200`).

## 5. Execution Venue Classification

1. Create a market.
2. As maker user, first acquire YES inventory via AMM BUY.
3. Place GTC ASK as maker.
4. Place crossing GTC BID as taker so fill executes.
5. Call `/api/portfolio` for maker and taker.
Expected:
- Maker portfolio includes at least one AMM trade with `executionVenue = AMM`.
- Maker portfolio includes exchange fill trade with `executionVenue = EXCHANGE` and `exchangeRole = MAKER`.
- Taker portfolio includes exchange fill trade with `executionVenue = EXCHANGE` and `exchangeRole = TAKER`.

## Fast Failure Signals

Treat as release blockers if any occur:

- `/api/portfolio` shape is missing key arrays/stats for authenticated users
- Unauthenticated portfolio access is not rejected
- Position valuation fields are missing or numerically inconsistent
- `stats` totals do not match sums derived from `positions`
- Reserved BID cash is not reflected in `reservedOrders` and `stats.reservedBalance`
- Created-market liquidity does not appear in `stats.liquidityLocked`
- Exchange fills are not classified as `EXCHANGE` or maker/taker roles are wrong

## Suggested Timing

- Target duration: 12-18 minutes
- Run on every release candidate touching portfolio API shaping, valuation logic, order reservation, execution matching, or market-status finalization pathways

## Related Docs

- `docs/MARKET_PORTFOLIO_SMOKE_CHECKLIST.md` - short pre-deploy portfolio pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-portfolio.js` - automated portfolio simulation