# Manual Test Simulation Guide

The repository includes a comprehensive API and business-flow simulation in `test-simulation.js`.

If you want a human-executed version of the same flow, use `docs/MANUAL_QA_CHECKLIST.md`.
For a short pre-deploy pass, use `docs/MANUAL_QA_SMOKE_CHECKLIST.md`.

## What it covers

- Authentication lifecycle: register, login, session isolation, logout
- Markets lifecycle: create, list, filter, search, fetch by id
- AMM trading: buy/sell, probability movement, insufficient funds validation
- Exchange orders: GTC, GTD, FOK, FAK, matching, cancellation, expiry checks
- Comments: post/list and validation constraints
- Market data: probability, chart history, resolution status view
- Portfolio: positions, trades, account stats
- Leaderboard: default/trades/ROI sorting
- Resolution flow: vote, settle payouts, trade lock after resolve
- Dispute flow: dispute, rollback, re-vote, re-resolution
- Edge cases: invalid JSON, invalid market/order/trade/vote/login inputs

## Run full simulation

```bash
npm run test:simulation
```

## Run one section (npm shortcuts)

```bash
npm run test:simulation:auth
npm run test:simulation:markets
npm run test:simulation:amm
npm run test:simulation:exchange
npm run test:simulation:comments
npm run test:simulation:data
npm run test:simulation:portfolio
npm run test:simulation:leaderboard
npm run test:simulation:resolution
npm run test:simulation:dispute
npm run test:simulation:edge
```

## Run one section (direct node command)

```bash
node test-simulation.js auth
node test-simulation.js markets
node test-simulation.js amm
node test-simulation.js exchange
node test-simulation.js comments
node test-simulation.js data
node test-simulation.js portfolio
node test-simulation.js leaderboard
node test-simulation.js resolution
node test-simulation.js dispute
node test-simulation.js edge
```

## Base URL override

```bash
BASE_URL=http://localhost:3001 npm run test:simulation
```

## Expected output

- Per-section pass/fail lines for each scenario
- Final summary with total passed and failed checks
- Non-zero exit code if any assertion fails

## Notes

- The simulation creates unique users and markets each run.
- Keep the app running before execution (`npm run dev`).
- The edge-case section uses a fresh funded user so it remains independent of prior spend in earlier sections.

---

## Related Testing Docs

### Money Conservation Simulation

A complementary simulation focused specifically on **money conservation invariants** — verifying that every code path that touches balances does so precisely, with no money created or destroyed.

- **Full checklist:** `docs/MONEY_CONSERVATION_QA_CHECKLIST.md` — step-by-step manual tests for all 12 scenarios
- **Smoke checklist:** `docs/MONEY_CONSERVATION_SMOKE_CHECKLIST.md` — 5–10 min pre-deploy verification
- **Run automated suite:** `npm run test:conservation` (41 tests, all scenarios)
- **Run API-only tests:** `npm run test:conservation:api` (fast, no DB settlement)
- **Run lifecycle tests:** `npm run test:conservation:lifecycle` (with settlement)

### Simulation Smoke Tests

Quick pre-deploy verification without full manual testing:

- **Simulation smoke:** `docs/MANUAL_QA_SMOKE_CHECKLIST.md` — 12-step smoke test for test-simulation.js
- **Conservation smoke:** `docs/MONEY_CONSERVATION_SMOKE_CHECKLIST.md` — 6-check smoke test for money invariants
