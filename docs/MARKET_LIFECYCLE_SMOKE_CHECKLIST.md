# Market Lifecycle Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated lifecycle simulation.

It focuses on the highest-risk state transitions:
- OPEN creation
- expiry auto-close
- provisional resolution
- definitive admin resolution
- immutable finalization
- short-position settlement
- dispute-driven re-resolution

## Setup

1. Ensure services are running:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open `http://localhost:3001`.
3. Keep DevTools Network tab open.
4. Prefer running the automated lifecycle suite first:

```bash
npm run test:lifecycle
```

Expected:
- `RESULTS: 19 passed, 0 failed`

## 8-Step Smoke Flow

1. Register a fresh creator and create a market with initial liquidity 100.
Expected: Balance drops by 100, market appears as `OPEN`, and creator portfolio shows `liquidityLocked = 100`.

2. Register a second user and place a GTC BID on that OPEN market.
Expected: Balance decreases by exactly `price * shares` and the order shows as open.

3. Wait for market expiry and refresh market detail.
Expected: Market auto-transitions to `CLOSED`, the BID is cancelled, and the reserved amount is fully refunded.

4. On a fresh short-expiry market, buy YES shares, wait for expiry, then resolve YES.
Expected: Market becomes `RESOLVED`, but creator liquidity remains locked and the winning position remains open because settlement is still pending.

5. After dispute-window expiry or a DB-assisted trigger, refresh portfolio.
Expected: Creator liquidity unlocks, open positions close, and the winning trader is paid exactly once.

6. On a separate market, run the dispute flow: provisional YES -> dispute -> two NO votes.
Expected: Market moves `RESOLVED -> DISPUTED -> RESOLVED`, final outcome is NO, and only the latest outcome is settled after finalization.

7. On a separate market, resolve through the admin page.
Expected: settlement is immediate, open orders are cancelled, and disputes are blocked.

8. On another market, open a short position before expiry and then resolve it.
Expected: short collateral stays locked until finalization and is then released or consumed exactly once.

## Fast Failure Signals

- Market does not auto-close after expiry
- CLOSED market still accepts trades/orders
- Provisional resolution pays out immediately
- Portfolio refresh does not finalize an immutable market
- Repeated refresh duplicates settlement side effects
- Definitive admin resolution still allows disputes or leaves orders uncleared
- Short collateral unlocks too early or settles twice
- Dispute flow does not require quorum or does not settle the latest outcome

## Suggested Timing

- Target duration: 10-15 minutes
- Run on each release candidate that touches market status, resolution, dispute, or order-expiry logic

## Related Docs

- `docs/MARKET_LIFECYCLE_QA_CHECKLIST.md` - full manual lifecycle checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main test guide
- `test-market-lifecycle.js` - automated lifecycle simulation
