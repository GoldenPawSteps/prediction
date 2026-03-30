# Market Liquidity Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated liquidity simulation.

It focuses on the highest-risk liquidity paths:
- creator liquidity lock on market creation
- portfolio lock accounting
- low vs high liquidity price impact behavior
- multi-outcome liquidity aggregation
- post-finalization liquidity unlock idempotency

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
npm run test:liquidity
```

Expected:
- `RESULTS: 11 passed, 0 failed`

## 6-Step Smoke Flow

1. Create a binary market with initial liquidity 120.
Expected: creator balance drops by 120 and portfolio `liquidityLocked` shows 120.

2. Create two 50/50 markets with funding 40 and 400.
Expected: the 400 market has higher `liquidityParam`.

3. Place BUY YES 10 on both markets.
Expected: low-liquidity market moves more and costs more for the same trade size.

4. Create a three-outcome MULTI market with child liquidities 50/150/300.
Expected: creator debit is 500 and parent liquidity is 500.

5. Create short-expiry market with liquidity 140, let it expire, resolve YES.
Expected: settlement is pending and liquidity remains locked.

6. Trigger immutable finalization and refresh twice.
Expected: liquidity unlocks once and does not unlock a second time.

## Fast Failure Signals

- Creator funding debit mismatch on create
- Portfolio `liquidityLocked` diverges from expected open-market funding
- Liquidity sensitivity behaves backward (high liquidity moves more than low)
- Multi parent funding does not equal child funding sum
- Liquidity unlocks before finalization or unlocks twice

## Suggested Timing

- Target duration: 7-10 minutes
- Run on each release candidate touching liquidity or settlement pathways

## Related Docs

- `docs/MARKET_LIQUIDITY_QA_CHECKLIST.md` - full manual liquidity checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-liquidity.js` - automated liquidity simulation