# Market Settlement Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated settlement simulation.

It focuses on the highest-risk settlement paths:
- provisional resolution without immediate payout
- definitive admin resolution
- immutable finalization
- zero-trade creator refund
- INVALID refund behavior
- short-position payout/collateral release behavior
- dispute re-resolution settling the latest outcome only

## Setup

1. Ensure services are running:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open `http://localhost:3001`.
3. Keep DevTools Network tab open.
4. Prefer running the automated suite first:

```bash
npm run test:settlement
```

Expected:
- `RESULTS: 13 passed, 0 failed`

## 9-Step Smoke Flow

1. Create a market, buy YES shares, expire it, and resolve YES.
Expected: market becomes provisionally resolved but payout is still pending.

2. Inspect creator and trader state before finalization.
Expected: creator liquidity remains locked and trader position remains open.

3. Trigger immutable finalization.
Expected: liquidity unlocks, position closes, and winning trader is paid exactly once.

4. Create a zero-trade market, resolve it, and finalize it.
Expected: creator fully recovers initial liquidity.

5. Create a traded market, resolve INVALID, then finalize.
Expected: trader gets cost-basis refund and creator liquidity unlocks.

6. Run dispute flow: provisional YES -> dispute -> two NO votes -> finalization.
Expected: final outcome is NO and only NO trader is paid.

7. Resolve a separate market from the admin panel.
Expected: settlement happens immediately, open orders are cancelled, and disputes are blocked.

8. Resolve a separate market containing a short position.
Expected: short collateral stays locked until finalization, then is released or consumed correctly.

9. Refresh the same finalized markets again.
Expected: no duplicate payouts or duplicate creator refunds.

## Fast Failure Signals

- Provisional resolution pays out immediately
- Finalization does not unlock liquidity
- INVALID settlement does not refund trader cost basis
- Repeated reads trigger duplicate settlement effects
- Definitive admin resolution leaves the market disputable or settlement-pending
- Short settlement releases or consumes the wrong collateral amount
- Dispute flow settles both old and new outcomes

## Suggested Timing

- Target duration: 8-12 minutes
- Run on each release candidate touching settlement logic

## Related Docs

- `docs/MARKET_SETTLEMENT_QA_CHECKLIST.md` - full manual settlement checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-settlement.js` - automated settlement simulation
