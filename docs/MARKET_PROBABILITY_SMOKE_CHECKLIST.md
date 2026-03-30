# Market Probability Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated probability simulation.

It focuses on the highest-risk probability paths:
- configured initial priors
- trade-driven movement
- binary normalization
- market detail and probability endpoint consistency
- resolved YES pinning
- INVALID neutral pinning
- multi-outcome child priors

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
npm run test:probability
```

Expected:
- `RESULTS: 12 passed, 0 failed`

## 7-Step Smoke Flow

1. Create a 75% prior binary market.
Expected: YES probability starts near `0.75` and is higher than NO.

2. Create a 25% prior binary market.
Expected: YES probability starts near `0.25` and NO is higher than YES.

3. Create a 50/50 market and buy YES.
Expected: YES probability increases and NO decreases.

4. On the same market, buy NO and then compare market detail with the probability endpoint.
Expected: both endpoints agree and YES + NO remains approximately `1.0`.

5. Create a short-expiry market, wait for expiry, and resolve YES.
Expected: probabilities pin to `1.0 / 0.0`.

6. Create another short-expiry market, wait for expiry, and resolve INVALID.
Expected: probabilities pin to `0.5 / 0.5`.

7. Create a three-outcome MULTI market with priors `60 / 25 / 15`.
Expected: child outcome probabilities appear in the same descending order and roughly match those priors.

## Fast Failure Signals

- Initial priors do not match configured values closely
- Trade direction moves probability the wrong way
- YES and NO probabilities do not sum to roughly `1`
- Probability endpoint and market detail disagree
- Resolved YES or INVALID markets expose non-pinned probabilities
- Multi-outcome child probabilities are missing or clearly misordered

## Suggested Timing

- Target duration: 6-10 minutes
- Run on each release candidate touching pricing or probability logic

## Related Docs

- `docs/MARKET_PROBABILITY_QA_CHECKLIST.md` - full manual probability checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-probability.js` - automated probability simulation