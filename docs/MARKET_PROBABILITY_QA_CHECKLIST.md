# Market Probability QA Checklist (Mapped to `test-market-probability.js`)

This checklist mirrors the dedicated probability simulation in `test-market-probability.js`, but in human-executable steps.

Use this when you want to manually verify configured priors, post-trade probability movement, normalization, endpoint consistency, resolved-market pinning, INVALID-market neutral pinning, and multi-outcome child probabilities.

For a shorter pre-deploy pass, use `docs/MARKET_PROBABILITY_SMOKE_CHECKLIST.md`.

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
- Creator: `creator+probability+<timestamp>@test.com`
- Trader A: `tradera+probability+<timestamp>@test.com`
- Trader B: `traderb+probability+<timestamp>@test.com`
- Password: `password123`

## 1. Initial Binary Priors

1. Register a fresh creator.
2. Create a binary market with prior probability 50% and liquidity 100.
Expected:
- Market is created successfully.
- Probability UI and API both show roughly `0.50 / 0.50`.

3. Create another binary market with prior probability 75%.
Expected:
- YES probability is higher than NO.
- Displayed YES probability is near `0.75`.

4. Create another binary market with prior probability 25%.
Expected:
- NO probability is higher than YES.
- Displayed YES probability is near `0.25`.

5. Request the probability endpoint for a fake market id.
Expected:
- API returns `404`.

## 2. Trading Moves Probabilities In The Expected Direction

1. Create a fresh 50/50 binary market.
2. Record the current YES and NO probabilities.
3. Buy YES shares.
Expected:
- YES probability increases.
- NO probability decreases.

4. From a second user, buy NO shares.
Expected:
- NO probability increases relative to the previous state.
- YES probability decreases relative to the previous state.

5. Sell part of the YES position.
Expected:
- YES probability moves downward.

## 3. Normalization And Endpoint Sync

1. Continue trading both sides of the same binary market.
2. Fetch market detail and the dedicated probability endpoint.
Expected:
- YES probability stays strictly between `0` and `1`.
- NO probability stays strictly between `0` and `1`.
- YES + NO remains approximately `1.0`.
- Market detail probabilities match `/api/markets/:id/probability`.

## 4. Resolved YES Market Pins To 1/0

1. Create a short-expiry binary market.
2. Buy YES shares.
3. Wait for market expiry and refresh the detail page.
Expected:
- Market is closed to further trading.

4. Resolve the market to YES.
Expected:
- Market shows resolved YES outcome.

5. Fetch both market detail and the probability endpoint.
Expected:
- YES probability is pinned to `1.0`.
- NO probability is pinned to `0.0`.
- Both endpoints agree.

## 5. INVALID Market Pins To 0.5/0.5

1. Create another short-expiry binary market.
2. Buy YES shares.
3. Wait for expiry and resolve the market to INVALID.
Expected:
- Market shows INVALID status.

4. Fetch both market detail and the probability endpoint.
Expected:
- YES probability is pinned to `0.5`.
- NO probability is pinned to `0.5`.
- Both endpoints agree.

## 6. Multi-Outcome Priors

1. Create a MULTI market with three outcomes:
- Alpha: prior 60%
- Beta: prior 25%
- Gamma: prior 15%

2. Open the market detail response and inspect the child outcomes.
Expected:
- Three outcomes are present.
- Alpha probability is highest.
- Beta probability is between Alpha and Gamma.
- Gamma probability is lowest.
- Displayed values are approximately `0.60`, `0.25`, and `0.15`.

## Fast Failure Signals

Treat as release blockers if any occur:

- A configured prior does not appear in the initial market probabilities
- Buying YES lowers YES probability, or buying NO lowers NO probability
- Binary probabilities drift so YES + NO is materially different from `1`
- Market detail and probability endpoint disagree for the same market
- Resolved YES does not pin to `1 / 0`
- INVALID does not pin to `0.5 / 0.5`
- Multi-outcome child priors are missing or in the wrong order

## Suggested Timing

- Target duration: 10-15 minutes
- Run on every release candidate touching pricing, probability endpoints, LMSR logic, market detail shaping, or resolution display logic

## Related Docs

- `docs/MARKET_PROBABILITY_SMOKE_CHECKLIST.md` - short pre-deploy probability pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-probability.js` - automated probability simulation