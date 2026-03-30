# UI/UX Simulation Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated UI/UX simulation.

It focuses on highest-risk UI/UX paths:
- core route availability and metadata
- login/register form affordances
- create-discover-detail user flow
- safe not-found and auth-gate behavior

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
npm run test:uiux
```

Expected:
- `RESULTS: 9 passed, 0 failed`

## 7-Step Smoke Flow

1. Open `/`, `/leaderboard`, `/portfolio`, `/auth/login`, `/auth/register`, `/markets/create`.
Expected: each route renders and none return 5xx.

2. Validate home branding and title.
Expected: page includes `Predictify`/`Prediction Markets`, and title includes `Predictify`.

3. Validate auth forms.
Expected: login has email/password inputs; register has username and password min-length affordance.

4. Create a market as authenticated user and search for it in `/api/markets?search=...`.
Expected: market is discoverable in list results.

5. Open `/markets/<id>` and call probability/chart/detail endpoints.
Expected: detail route is stable; probability remains normalized; chart returns history data.

6. Verify UX resilience basics.
Expected: unknown route returns 4xx (not 5xx).

7. Verify auth/error safety.
Expected: anonymous `/api/portfolio` returns `401`; invalid trade/order payloads are rejected without changing balance.

## Fast Failure Signals

- Core routes return 5xx
- Missing auth form fields
- Created market not discoverable via search/list
- Probability endpoint returns invalid normalization
- Not-found route crashes server
- Anonymous portfolio access unexpectedly succeeds
- Rejected invalid interactions alter balance

## Suggested Timing

- Target duration: 8-12 minutes
- Run on each release candidate touching UI routing, auth pages, market views, or API validation

## Related Docs

- `docs/UI_UX_SIMULATION_QA_CHECKLIST.md` - full manual UI/UX checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main simulation guide
- `test-ui-ux-simulation.js` - automated UI/UX simulation