# Market Balance Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated balance simulation.

It focuses on the highest-risk balance paths:
- wallet and portfolio available-balance sync
- market funding debits
- AMM BUY/SELL exactness
- short collateral locking plus exchange reserve/cancel exactness
- rejected-operation no-mutation guarantees

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
npm run test:balance
```

Expected:
- `RESULTS: 10 passed, 0 failed`

## 6-Step Smoke Flow

1. Register fresh user and compare `/api/auth/me` with `/api/portfolio` stats.
Expected: `stats.availableBalance` matches wallet balance.

2. Create market with `initialLiquidity=135`.
Expected: creator balance drops by `135` and liquidity lock reflects the funding.

3. Perform AMM BUY then SELL, including one SELL larger than current inventory on a fresh market.
Expected: BUY debits by `trade.totalCost`, SELL credits by `abs(trade.totalCost)`, and funded oversells open collateralized short exposure instead of failing.

4. Place GTC BID (`0.42 × 10`) and then cancel.
Expected: reserve debit is exact and cancel fully restores balance.

5. Execute crossing naked ASK/BID fill.
Expected: initial ASK locks short collateral, fill executes, buyer payment goes into collateral rather than double-debiting the seller, and combined buyer+seller balances remain conserved.

6. Submit one oversized AMM BUY and one invalid order payload.
Expected: both fail and balances do not change.

## Fast Failure Signals

- Balance mismatch between wallet and portfolio stats
- Funding debits not equal to initial liquidity
- BUY/SELL deltas inconsistent with reported trade cost
- BID reserve/cancel not exact, or naked ASK collateral is miscomputed
- Net money drift on direct fills
- Rejected mutation requests changing balances

## Suggested Timing

- Target duration: 7-10 minutes
- Run on each release candidate touching money movement logic

## Related Docs

- `docs/MARKET_BALANCE_QA_CHECKLIST.md` - full manual balance checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-balance.js` - automated balance simulation