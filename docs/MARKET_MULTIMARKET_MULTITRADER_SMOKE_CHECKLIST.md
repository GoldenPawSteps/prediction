# Market MultiMarket MultiTrader Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated multi-market multi-trader simulation.

It focuses on the highest-risk concurrent-flow paths:
- multi-market setup integrity
- cross-market AMM activity and probability coherence
- exchange matching under shared-market participation
- cross-user portfolio consistency
- trades leaderboard stability under activity load

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
npm run test:multimarket-multitrader
```

Expected:
- `RESULTS: 9 passed, 0 failed`

## 6-Step Smoke Flow

1. Register creator + 3 traders, then create 2 binary + 1 multi parent market.
Expected: setup succeeds and multi market exposes three children.

2. Execute AMM buys across all markets plus one sell on one binary market.
Expected: all succeed and market probabilities remain coherent.

3. Seed inventory, place ASK/BID crossing orders on one shared binary market.
Expected: exchange fill occurs (`filledShares > 0`).

4. Place and cancel separate reserve BID on another market.
Expected: reserve debit and refund are exact.

5. Fetch trader portfolios and creator portfolio.
Expected: trader activity appears; creator created-markets and locked liquidity are coherent.

6. Fetch leaderboard with `sortBy=trades`.
Expected: entries remain descending by totalTrades.

## Fast Failure Signals

- Child-market expansion missing for multi parent
- Probability normalization breaks after cross-market AMM activity
- Exchange crossing orders fail to fill
- Reserve debit/refund mismatch
- Portfolio state missing expected cross-market activity
- Trades leaderboard returns unsorted entries under active load

## Suggested Timing

- Target duration: 8-12 minutes
- Run on each release candidate touching multi-user trading paths

## Related Docs

- `docs/MARKET_MULTIMARKET_MULTITRADER_QA_CHECKLIST.md` - full manual multimarket checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-multimarket-multitrader.js` - automated multimarket simulation