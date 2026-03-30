# Market Leaderboard QA Checklist (Mapped to `test-market-leaderboard.js`)

This checklist mirrors the dedicated leaderboard simulation in `test-market-leaderboard.js`, but in human-executable steps.

Use this when you want to manually verify leaderboard response shape, sorting behavior, rank stability, and high-trade activity ordering.

For a shorter pre-deploy pass, use `docs/MARKET_LEADERBOARD_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-db
npm run db:reset
npm run dev
```

2. Open the app at `http://localhost:3001`.
3. Keep DevTools open on the Network tab.
4. Use fresh users for activity-seeding scenarios.

Suggested users:
- Creator: `creator+leaderboard+<timestamp>@test.com`
- Active trader: `active+leaderboard+<timestamp>@test.com`
- Passive trader: `passive+leaderboard+<timestamp>@test.com`
- Password: `password123`

## 1. Response Shape And Public Access

1. Call `/api/leaderboard` without authentication.
Expected:
- Endpoint is publicly accessible.
- Response contains `entries` array and `timestamp`.

2. Validate response metadata.
Expected:
- `timestamp` is valid ISO date/time.
- `entries.length <= 100`.

3. Inspect one entry (if present).
Expected fields:
- `id`
- `username`
- `balance` (number)
- `totalRealizedPnl` (number)
- `roi` (number)
- `totalTrades` (number)

## 2. Sorting Behavior

1. Call default leaderboard `/api/leaderboard`.
Expected:
- Entries are sorted descending by `totalRealizedPnl`.

2. Call `/api/leaderboard?sortBy=trades`.
Expected:
- Entries are sorted descending by `totalTrades`.

3. Call `/api/leaderboard?sortBy=roi`.
Expected:
- Entries are sorted descending by `roi`.

4. Call `/api/leaderboard?sortBy=unknown-sort`.
Expected:
- Endpoint still succeeds.
- Sort behavior falls back to default profit ordering (`totalRealizedPnl` descending).

## 3. High-Activity Trades Ranking

1. Register creator, active trader, and passive trader.
2. Create one market as creator.
3. Execute many trades from active trader (for example 30 small AMM buys alternating YES/NO).
4. Execute one trade from passive trader.
5. Call `/api/leaderboard?sortBy=trades`.
Expected:
- Trade-sort order remains descending for all visible entries.
- If both users are visible in returned entries, active trader ranks above passive trader.
- Active trader totalTrades is materially higher than passive trader totalTrades.

## 4. Timestamp Freshness

1. Call `/api/leaderboard` twice with a short delay (1-2s).
Expected:
- Second timestamp is same or later than first.
- Both responses remain valid shape/sort outputs.

## Fast Failure Signals

Treat as release blockers if any occur:

- Leaderboard endpoint requires auth
- Missing `entries` or invalid `timestamp`
- Returned entry count exceeds 100
- Default/trades/roi sorts are not descending by their requested metric
- Unknown `sortBy` causes error or does not fall back safely
- High-activity users are mis-ranked relative to clearly lower-activity users when both are present

## Suggested Timing

- Target duration: 10-15 minutes
- Run on every release candidate touching leaderboard ranking logic, user trade accounting, or ROI/profit aggregation

## Related Docs

- `docs/MARKET_LEADERBOARD_SMOKE_CHECKLIST.md` - short pre-deploy leaderboard pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-leaderboard.js` - automated leaderboard simulation