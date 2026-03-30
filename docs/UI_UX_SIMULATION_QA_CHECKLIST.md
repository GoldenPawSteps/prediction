# UI/UX Simulation QA Checklist (Mapped to `test-ui-ux-simulation.js`)

This checklist mirrors the dedicated UI/UX simulation in `test-ui-ux-simulation.js`, but in human-executable steps.

Use this when you want to manually verify route availability, key UX affordances, flow coherence, and high-risk error handling.

For a shorter pre-deploy pass, use `docs/UI_UX_SIMULATION_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-db
npm run db:reset
npm run dev
```

2. Open the app at `http://localhost:3001`.
3. Keep DevTools open on the Network tab.
4. Use fresh users for flow checks.

Suggested users:
- Creator: `creator+uiux+<timestamp>@test.com`
- Trader: `trader+uiux+<timestamp>@test.com`
- Password: `password123`

## 1. Route Surface And Affordances

1. Open each route:
- `/`
- `/leaderboard`
- `/portfolio`
- `/auth/login`
- `/auth/register`
- `/markets/create`

Expected:
- Every route responds without server error.
- Each route returns full HTML page output.

2. Validate home shell and metadata.
Expected:
- Page branding includes `Predictify` or `Prediction Markets`.
- Document title includes `Predictify`.

3. Validate auth form affordances.
Expected on login page:
- Email input is present.
- Password input is present.
Expected on register page:
- Username input is present.
- Password minimum length affordance is visible (8 chars).

## 2. Primary Interaction Flow

1. Register and log in as creator and trader users.
Expected:
- Both users can authenticate successfully.

2. Create a binary market as creator.
Expected:
- Market creation succeeds (`201`).
- Creator balance decreases after initial funding.

3. Discover created market via search/list endpoint.
Expected:
- `/api/markets?search=<market title fragment>` includes the created market.

4. Open market detail page `/markets/<marketId>`.
Expected:
- Route renders without 5xx errors.

5. Execute a valid trader buy and inspect data endpoints.
Expected:
- Trade succeeds.
- `/api/markets/<id>/probability` returns normalized values (`yes + no ~= 1`).
- `/api/markets/<id>/chart` returns `priceHistory` array.
- `/api/markets/<id>` includes numeric `totalVolume`.

6. Check interactive response budget for key UX APIs.
Endpoints:
- `/api/markets`
- `/api/leaderboard?sortBy=trades`

Expected:
- Both succeed within an acceptable interactive threshold.

## 3. Resilience And UX Safety

1. Open unknown route `/this-route-should-not-exist`.
Expected:
- Route returns 4xx, not 5xx.

2. Call `/api/portfolio` without auth.
Expected:
- Request fails with `401`.

3. Attempt invalid interactions on an existing market:
- Negative-share AMM trade.
- Invalid order price (outside valid range).

Expected:
- Both actions are rejected.
- User balance does not change after rejected actions.

## Fast Failure Signals

Treat as release blockers if any occur:

- Any core route returns 5xx
- Home page loses key branding/title metadata
- Login/register form affordances are missing
- Created market cannot be discovered via listing/search
- Probability endpoint returns non-normalized values
- Unknown route crashes server instead of returning 4xx
- Anonymous portfolio access no longer returns `401`
- Rejected interactions mutate user balance

## Suggested Timing

- Target duration: 15-20 minutes
- Run on releases touching navigation, auth UX, market discovery, detail data wiring, or API validation/error handling

## Related Docs

- `docs/UI_UX_SIMULATION_SMOKE_CHECKLIST.md` - short pre-deploy UI/UX pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-ui-ux-simulation.js` - automated UI/UX simulation