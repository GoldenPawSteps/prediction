# Market Leaderboard Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated leaderboard simulation.

It focuses on the highest-risk leaderboard paths:
- public response shape and timestamp validity
- default/trades/roi sorting behavior
- safe fallback for unknown sort values
- trade-activity ranking behavior

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
npm run test:leaderboard
```

Expected:
- `RESULTS: 6 passed, 0 failed`

## 6-Step Smoke Flow

1. Call `/api/leaderboard` unauthenticated.
Expected: request succeeds with `entries` and `timestamp`.

2. Verify response cap and entry fields.
Expected: `entries.length <= 100` and key numeric fields are present.

3. Call `/api/leaderboard` (default sort).
Expected: `totalRealizedPnl` ordering is descending.

4. Call `/api/leaderboard?sortBy=trades` and `/api/leaderboard?sortBy=roi`.
Expected: requested metric is descending in each response.

5. Call `/api/leaderboard?sortBy=unknown-sort`.
Expected: response succeeds and falls back to default profit ordering.

6. Seed one high-activity user and one low-activity user, then fetch `sortBy=trades`.
Expected: trades ordering remains descending; if both users are visible, high-activity user ranks above low-activity user.

## Fast Failure Signals

- Endpoint is no longer public
- Invalid/missing timestamp or malformed entry payload
- Any sort mode returns non-descending order for its metric
- Unknown sort input returns error instead of safe fallback
- Clearly higher-activity user ranks below lower-activity user when both are present

## Suggested Timing

- Target duration: 6-10 minutes
- Run on each release candidate touching leaderboard ranking or aggregation logic

## Related Docs

- `docs/MARKET_LEADERBOARD_QA_CHECKLIST.md` - full manual leaderboard checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-market-leaderboard.js` - automated leaderboard simulation