# Market Settlement QA Checklist (Mapped to `test-market-settlement.js`)

This checklist mirrors the dedicated settlement simulation in `test-market-settlement.js`, but in human-executable steps.

Use this when you want to manually verify deferred settlement behavior, immutable finalization, INVALID refunds, creator liquidity unlocks, idempotent finalization, and dispute-driven re-resolution settlement.

For a shorter pre-deploy pass, use `docs/MARKET_SETTLEMENT_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open the app at `http://localhost:3001`.
3. Keep DevTools open on the Network tab.
4. Use fresh users for each scenario.

Suggested users:
- Creator: `creator+settlement+<timestamp>@test.com`
- Trader A: `tradera+settlement+<timestamp>@test.com`
- Trader B: `traderb+settlement+<timestamp>@test.com`
- Password: `password123`

## 1. Provisional YES Settlement Stays Pending First

1. Register a fresh creator and trader.
2. Create a binary market with:
- Initial liquidity 100
- Dispute window 1 hour
- End date a short time in the future

3. Trader buys 40 YES shares.
Expected:
- Trade succeeds.
- Trader balance decreases.

4. Wait for the market to expire and refresh the market detail page.
Expected:
- Market is no longer open.

5. Resolve the market to YES.
Expected:
- Response indicates settlement is still pending.
- Market shows `RESOLVED` with outcome YES.

6. Immediately inspect creator portfolio and trader portfolio.
Expected:
- Creator liquidity is still locked.
- Trader position is still open.
- Trader has not yet received payout.

## 2. Immutable Finalization Settles Exactly Once

Manual note:
- In the automated simulation, finalization is triggered by backdating `resolutionTime` in the database.
- In pure manual testing, either wait for dispute-window expiry or use a DB helper.

1. Trigger finalization after dispute-window expiry.
Expected:
- Creator liquidity unlocks.
- Trader position closes.
- Winning trader receives payout.

2. Trigger the same finalization path again by refreshing portfolio/detail.
Expected:
- No second payout occurs.
- No second creator refund occurs.
- State stays settled and unchanged.

## 3. Zero-Trade Settlement

1. Register a fresh creator.
2. Create a market with initial liquidity 150.
3. Do not place any trades.
4. Wait for expiry and resolve the market.
Expected:
- Resolution succeeds but remains settlement-pending at first.

5. After immutable finalization, inspect creator balance.
Expected:
- Creator fully recovers the locked initial liquidity.

6. Trigger the same finalization path again.
Expected:
- Creator balance does not change again.

## 4. INVALID Settlement

1. Register fresh creator and trader.
2. Create a market with initial liquidity 80.
3. Trader buys 20 YES shares.
4. Wait for expiry.
5. Resolve the market to INVALID.
Expected immediately:
- Market status shows `INVALID`.
- Probabilities display neutral `0.5 / 0.5`.
- Trader is not refunded yet.

6. Trigger immutable finalization.
Expected:
- Creator liquidity unlocks.
- Trader position closes.
- Trader receives full cost-basis refund.

## 5. Dispute And Latest-Outcome Settlement

1. Register fresh creator, YES trader, and NO trader.
2. Create a market with:
- Initial liquidity 100
- Long dispute window
- Short expiry

3. YES trader buys 30 YES.
4. NO trader buys 25 NO.
5. Wait for expiry.

6. Creator casts first vote for YES.
Expected:
- Market provisionally resolves to YES.
- No payout happens yet.

7. NO trader files dispute proposing NO.
Expected:
- Market enters `DISPUTED`.
- Neither side is paid yet.

8. Cast first re-vote for NO.
Expected:
- Market stays `DISPUTED` because quorum is not yet met.

9. Cast second re-vote for NO.
Expected:
- Market re-resolves to NO.

10. Trigger immutable finalization after dispute-window expiry.
Expected:
- Both positions close.
- Only the latest NO outcome is settled.
- NO trader receives payout.
- YES trader does not receive payout.

## Fast Failure Signals

Treat as release blockers if any occur:

- Settlement happens immediately at provisional resolution time
- Creator liquidity unlocks before finalization
- Winning trader is paid before finalization
- INVALID does not refund cost basis after finalization
- Repeated finalization duplicates payout/refund side effects
- Dispute flow pays both old and new outcomes

## Suggested Timing

- Target duration: 15-25 minutes
- Run on every release candidate touching settlement, resolution, dispute, or finalization logic

## Related Docs

- `docs/MARKET_SETTLEMENT_SMOKE_CHECKLIST.md` - short pre-deploy settlement pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-settlement.js` - automated settlement simulation
