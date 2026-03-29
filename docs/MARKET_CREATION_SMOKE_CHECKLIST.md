# Market Creation Smoke Checklist

Use this for a quick pre-deploy verification of the dedicated creation simulation.

It focuses on the highest-risk creation paths:
- valid BINARY creation
- valid MULTI creation
- key validation rejects
- insufficient funds reject
- list/search/filter visibility

## Setup

1. Ensure services are running:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open `http://localhost:3001`.
3. Keep DevTools Network tab open.
4. Prefer running the automated creation suite first:

```bash
npm run test:market-creation
```

Expected:
- `RESULTS: 27 passed, 0 failed`

## 8-Step Smoke Flow

1. Register two fresh users (Creator A and Creator B).
Expected: both accounts succeed and sessions are independent.

2. Creator A creates a valid BINARY market.
Expected: `201`, market payload returned, market appears as open.

3. Creator A creates a valid MULTI market with at least 2 outcomes.
Expected: `201`, `marketType = MULTI`, market appears in list.

4. Attempt creation with a short title (< 10 chars).
Expected: rejected with validation error.

5. Attempt MULTI creation with duplicate outcome names.
Expected: rejected.

6. Attempt BINARY creation with insufficient funds (very large liquidity, for example 50000).
Expected: rejected with insufficient-balance style error.

7. Open markets list and verify newly created markets are present.
Expected: list is non-empty and includes newly created titles.

8. Verify category filter and search for one created market keyword.
Expected: filter/search returns expected market entries.

## Fast Failure Signals

- Valid BINARY or MULTI creation fails
- Validation accepts clearly invalid payloads
- Insufficient-balance creation succeeds
- Created markets do not appear in list/filter/search

## Suggested Timing

- Target duration: 8-12 minutes
- Run on each release candidate touching market creation, input schemas, or validation logic

## Related Docs

- `docs/MARKET_CREATION_QA_CHECKLIST.md` - full manual creation checklist
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-creation.js` - automated creation simulation