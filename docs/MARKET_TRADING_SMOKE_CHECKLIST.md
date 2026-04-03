# Market Trading Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated trading simulation.

It focuses on the highest-risk trading paths:
- AMM buy/sell behavior
- collateralized short-selling behavior
- probability integrity
- order matching and cancellation
- time-in-force validation (FOK/FAK/GTD)
- auth and invalid-input rejection

## Setup

1. Ensure services are running:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open `http://localhost:3001`.
3. Keep DevTools Network tab open.
4. Prefer running automated suite first:

```bash
npm run test:market-trading
```

Expected:
- `RESULTS: 18 passed, 0 failed`

## 8-Step Smoke Flow

1. Register two users and create one binary market.
Expected: setup succeeds and market is open.

2. User A buys YES via AMM.
Expected: success, positive `totalCost`, YES probability increases.

3. User B buys NO via AMM, then User A sells some YES and oversells on a fresh funded market.
Expected: BUY has positive `totalCost`, SELL has negative `totalCost`, and funded oversell opens short exposure instead of failing.

4. Verify `GET /api/markets/[id]/probability`.
Expected: YES and NO are valid and sum to about 1.

5. Place non-crossing BID/ASK orders, including one naked ASK, then place a crossing order.
Expected: non-crossing orders stay unfilled, naked ASK reserves collateral immediately, and crossing order fills at least partially.

6. Place and cancel a BID order.
Expected: cancel succeeds and order shows `CANCELLED` in user history.

7. Validate time-in-force rules.
Expected: FOK without liquidity fails/cancels, FAK partially fills/cancels remainder, GTD future accepted, GTD past rejected.

8. Try one unauthenticated trade or order and one fake-id trade.
Expected: all rejected.

## Fast Failure Signals

- Valid AMM trades fail
- Funded short sells fail, or undercollateralized short sells succeed
- Probability no longer sums to ~1
- Crossing orders fail to fill
- Cancel does not move order to `CANCELLED`
- FOK/FAK/GTD rules are ignored
- Protected trading endpoints accept unauthenticated requests

## Suggested Timing

- Target duration: 8-12 minutes
- Run on each release candidate that touches trading logic

## Related Docs

- `docs/MARKET_TRADING_QA_CHECKLIST.md` - full manual trading checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-trading.js` - automated trading simulation
