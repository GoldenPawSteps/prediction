# Manual QA Smoke Checklist

Use this for quick regression checks before deploys. It is intentionally short and focuses on high-risk user journeys.

## Setup

1. Ensure services are running:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open `http://localhost:3001`.
3. Keep DevTools Network tab open.
4. Use two fresh users:
- Alice: `alice+smoke+<timestamp>@test.com`
- Bob: `bob+smoke+<timestamp>@test.com`
- Password: `password123`

## 12-Step Smoke Flow

1. Register Alice.
Expected: Registration succeeds, session established, balance starts at 1000.

2. Register Bob.
Expected: Second account succeeds and is independent.

3. Alice creates a binary market.
Expected: Market is created and visible as OPEN.

4. Bob finds the market via list/search.
Expected: Market appears in results and opens correctly.

5. Alice buys YES shares (AMM).
Expected: Trade succeeds, Alice balance decreases, YES probability increases.

6. Bob buys NO shares (AMM).
Expected: Trade succeeds and market probability updates.

7. Bob places GTC ASK and Alice places crossing BID.
Expected: Orders are accepted and at least partial fill occurs.

8. Alice posts a comment; Bob sees it in comments list.
Expected: Comment persists and appears in newest-first order.

9. Open probability and chart endpoints for the market.
Expected: Probability is valid (YES + NO ~= 1), chart returns non-empty history.

10. Open Alice portfolio and leaderboard page.
Expected: Portfolio shows positions/trades/stats, leaderboard loads with entries.

11. Create a short-expiry market, trade once, wait to expire, then vote to resolve.
Expected: Market resolves, remains settlement-pending until finalization, and cannot be traded afterward.

12. Try one protected action while logged out (for example POST comment or trade).
Expected: Rejected with auth error (or redirect to login).

## Fast Failure Signals

Treat as release blockers if any occur:

- Auth session confusion between users
- Market creation/trading fails with valid input
- Probability endpoint returns invalid values
- Order matching path fails to fill crossing orders
- Resolution fails to finalize or allows post-resolution trading
- Portfolio/leaderboard fails to load
- Protected endpoints succeed without auth

## Suggested Timing

- Target duration: 10-20 minutes
- Run this on every release candidate
- Run full checklist in `docs/MANUAL_QA_CHECKLIST.md` for deeper validation
