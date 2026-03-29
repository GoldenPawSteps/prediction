# Market Creation QA Checklist (Mapped to `test-market-creation.js`)

This checklist mirrors the dedicated creation simulation in `test-market-creation.js`, but in human-executable steps.

Use this when you want to manually verify market creation behavior end to end: binary creation, multi-outcome creation, input validation, funding constraints, and list/search visibility.

For a shorter pre-deploy pass, use `docs/MARKET_CREATION_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open app at `http://localhost:3001`.
3. Keep DevTools open (Network tab) to verify request/response status.
4. Use fresh users per run to avoid collisions.

Suggested users:
- Creator A: `creatora+creation+<timestamp>@test.com`
- Creator B: `creatorb+creation+<timestamp>@test.com`
- Password: `password123`

## 1. Auth Setup For Creation Scenarios

1. Register Creator A.
Expected:
- Registration succeeds.
- Session is established.

2. Register Creator B.
Expected:
- Registration succeeds.
- Account is distinct from Creator A.

3. Confirm each user can log in and `GET /api/auth/me` returns the matching identity.
Expected:
- `200` and correct user id/username.

## 2. Binary Market Creation

1. As Creator A, create a BINARY market with:
- Valid title and description
- Category (for example `Cryptocurrency`)
- Valid future end date
- Valid resolution source URL
- Initial liquidity 50
- Prior probability 0.5

Expected:
- `POST /api/markets` returns `201`.
- Response includes `market.id` and `marketType = BINARY`.
- Market appears in the list as open.

2. Create another BINARY market with prior probability 0.75.
Expected:
- `201` created.
- Response has a valid market payload.

3. Create another BINARY market with prior probability 0.25.
Expected:
- `201` created.
- Response has a valid market payload.

## 3. Multi-Outcome Market Creation

1. As Creator A, create a MULTI market with 4 outcomes:
- France (50)
- Brazil (50)
- Germany (50)
- Other (50)

Expected:
- `POST /api/markets` returns `201`.
- Response includes `market.id` and `marketType = MULTI`.

2. Create a minimal MULTI market with 2 outcomes.
Expected:
- `201` created.
- Market is valid and visible in markets list/detail.

## 4. Validation And Error Handling

1. Try creating a market with title shorter than 10 chars.
Expected:
- Rejected with `400`.

2. Try creating a market with title longer than 200 chars.
Expected:
- Rejected.

3. Try creating a market with description shorter than 20 chars.
Expected:
- Rejected.

4. Try invalid market type.
Expected:
- Rejected.

5. Try MULTI with only one outcome.
Expected:
- Rejected.

6. Try MULTI with duplicate outcome names.
Expected:
- Rejected.

7. Try prior probability outside `[0.01, 0.99]`.
Expected:
- Rejected.

8. Try initial liquidity below minimum (for example 5).
Expected:
- Rejected.

9. Try invalid `resolutionSource` URL.
Expected:
- Rejected.

## 5. Balance And Insufficient Funds

1. Create a valid BINARY market as Creator A.
Expected:
- Creation succeeds (`201`).

2. Create a valid MULTI market as Creator B.
Expected:
- Creation succeeds (`201`).

3. Attempt an oversized BINARY market creation with liquidity well above available balance (for example 50000).
Expected:
- Rejected with `400` and insufficient-balance style error.

## 6. Creation Visibility In Market Discovery

1. Open `GET /api/markets`.
Expected:
- Non-empty list including newly created markets.

2. Filter by category used earlier (for example `Cryptocurrency`).
Expected:
- Returned markets match that category.

3. Search by a unique keyword from a newly created title.
Expected:
- Matching market appears.

4. Open one created market detail page.
Expected:
- Response/UI includes core fields: id, title, status, probability payload.

## Fast Failure Signals

Treat as release blockers if any occur:

- Valid creation payloads fail with 4xx/5xx
- Invalid payloads are accepted
- MULTI creation accepts fewer than 2 outcomes
- Duplicate outcome names are accepted
- Insufficient-balance creation is accepted
- Created markets do not appear in list/search/filter paths

## Suggested Timing

- Target duration: 15-25 minutes
- Run on every release candidate that changes market creation or validation logic

## Related Docs

- `docs/MARKET_CREATION_SMOKE_CHECKLIST.md` - short pre-deploy creation smoke pass
- `docs/MANUAL_TEST_SIMULATION.md` - main testing guide
- `test-market-creation.js` - automated creation simulation