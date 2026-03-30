# Manual Test Simulation Guide

The repository includes a comprehensive API and business-flow simulation in `test-simulation.js`.

If you want a human-executed version of the same flow, use `docs/MANUAL_QA_CHECKLIST.md`.
For a short pre-deploy pass, use `docs/MANUAL_QA_SMOKE_CHECKLIST.md`.

The repository also includes a dedicated market-creation simulation in `test-market-creation.js`.
For manual creation-only verification, use `docs/MARKET_CREATION_QA_CHECKLIST.md`.
For a short creation pre-deploy pass, use `docs/MARKET_CREATION_SMOKE_CHECKLIST.md`.

The repository also includes a dedicated market-trading simulation in `test-market-trading.js`.
For manual trading-only verification, use `docs/MARKET_TRADING_QA_CHECKLIST.md`.
For a short trading pre-deploy pass, use `docs/MARKET_TRADING_SMOKE_CHECKLIST.md`.

The repository also includes a dedicated market-settlement simulation in `test-market-settlement.js`.
For manual settlement-only verification, use `docs/MARKET_SETTLEMENT_QA_CHECKLIST.md`.
For a short settlement pre-deploy pass, use `docs/MARKET_SETTLEMENT_SMOKE_CHECKLIST.md`.

The repository also includes a dedicated market-probability simulation in `test-market-probability.js`.
For manual probability-only verification, use `docs/MARKET_PROBABILITY_QA_CHECKLIST.md`.
For a short probability pre-deploy pass, use `docs/MARKET_PROBABILITY_SMOKE_CHECKLIST.md`.

The repository also includes a dedicated market-liquidity simulation in `test-market-liquidity.js`.
For manual liquidity-only verification, use `docs/MARKET_LIQUIDITY_QA_CHECKLIST.md`.
For a short liquidity pre-deploy pass, use `docs/MARKET_LIQUIDITY_SMOKE_CHECKLIST.md`.

The repository also includes a dedicated market-portfolio simulation in `test-market-portfolio.js`.
For manual portfolio-only verification, use `docs/MARKET_PORTFOLIO_QA_CHECKLIST.md`.
For a short portfolio pre-deploy pass, use `docs/MARKET_PORTFOLIO_SMOKE_CHECKLIST.md`.

## What it covers

- Authentication lifecycle: register, login, session isolation, logout
- Markets lifecycle: create, list, filter, search, fetch by id
- AMM trading: buy/sell, probability movement, insufficient funds validation
- Exchange orders: GTC, GTD, FOK, FAK, matching, cancellation, expiry checks
- Comments: post/list and validation constraints
- Market data: probability, chart history, resolution status view
- Portfolio: positions, trades, account stats
- Leaderboard: default/trades/ROI sorting
- Resolution flow: vote, provisional resolve, finalization, trade lock after resolve
- Dispute flow: dispute, re-vote, re-resolution, latest-outcome finalization
- Edge cases: invalid JSON, invalid market/order/trade/vote/login inputs

## Run full simulation

```bash
npm run test:simulation
```

## Run all simulations

Use this when you want a full regression pass across business flow, market creation, market trading, market settlement, market probability, market liquidity, market portfolio, money conservation, and lifecycle state transitions:

```bash
npm run test:all-simulations
```

What this covers:

- `test-simulation.js`: broad product and API behavior
- `test-market-creation.js`: market creation correctness and validation boundaries
- `test-market-trading.js`: AMM and exchange trading behavior and rejection paths
- `test-market-settlement.js`: deferred, invalid, and dispute-driven settlement behavior
- `test-market-probability.js`: prior calibration, probability movement, endpoint sync, and resolution pinning
- `test-market-liquidity.js`: creator liquidity locks, multi aggregation, price-impact sensitivity, and unlock finalization
- `test-market-portfolio.js`: portfolio shape, valuation stats, reserve accounting, and execution classification
- `test-money-conservation.js`: balance integrity and payout accounting
- `test-market-lifecycle.js`: state transitions from OPEN through final settlement

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

### Market Creation Simulation Shortcuts

```bash
npm run test:market-creation
npm run test:market-creation:binary
npm run test:market-creation:multi
npm run test:market-creation:validation
npm run test:market-creation:balance
npm run test:market-creation:listing
```

### Market Trading Simulation Shortcuts

```bash
npm run test:market-trading
npm run test:market-trading:amm
npm run test:market-trading:exchange
```

### Market Settlement Simulation Shortcuts

```bash
npm run test:settlement
npm run test:settlement:core
npm run test:settlement:invalid
npm run test:settlement:dispute
```

### Market Probability Simulation Shortcuts

```bash
npm run test:probability
npm run test:probability:initial
npm run test:probability:trading
npm run test:probability:resolution
npm run test:probability:multi
```

### Market Liquidity Simulation Shortcuts

```bash
npm run test:liquidity
npm run test:liquidity:lock
npm run test:liquidity:sensitivity
npm run test:liquidity:multi
npm run test:liquidity:unlock
```

### Market Portfolio Simulation Shortcuts

```bash
npm run test:portfolio
npm run test:portfolio:basics
npm run test:portfolio:positions
npm run test:portfolio:reserves
npm run test:portfolio:created
npm run test:portfolio:exchange
```

---

## Related Testing Docs

### Money Conservation Simulation

A complementary simulation focused specifically on **money conservation invariants** — verifying that every code path that touches balances does so precisely, with no money created or destroyed.

- **Full checklist:** `docs/MONEY_CONSERVATION_QA_CHECKLIST.md` — step-by-step manual tests for all 12 scenarios
- **Smoke checklist:** `docs/MONEY_CONSERVATION_SMOKE_CHECKLIST.md` — 5–10 min pre-deploy verification
- **Run automated suite:** `npm run test:conservation` (41 tests, all scenarios)
- **Run API-only tests:** `npm run test:conservation:api` (fast, no DB settlement)
- **Run lifecycle tests:** `npm run test:conservation:lifecycle` (with settlement)

### Market Creation Simulation

A dedicated simulation focused on **market creation correctness** — verifying valid BINARY and MULTI creation paths, schema validation, insufficient-funds handling, and market discoverability after creation.

- **Full checklist:** `docs/MARKET_CREATION_QA_CHECKLIST.md` — manual verification of all creation scenarios
- **Smoke checklist:** `docs/MARKET_CREATION_SMOKE_CHECKLIST.md` — short pre-deploy creation pass
- **Run automated suite:** `npm run test:market-creation` (27 checks)
- **Run binary-only checks:** `npm run test:market-creation:binary`
- **Run multi-only checks:** `npm run test:market-creation:multi`
- **Run validation-only checks:** `npm run test:market-creation:validation`
- **Run balance-only checks:** `npm run test:market-creation:balance`
- **Run listing-only checks:** `npm run test:market-creation:listing`

### Market Trading Simulation

A dedicated simulation focused on **trading correctness** — verifying AMM BUY/SELL behavior, probability invariants, order-book matching and cancellation, time-in-force rules (GTC/GTD/FOK/FAK), and auth/invalid-input rejection paths.

- **Full checklist:** `docs/MARKET_TRADING_QA_CHECKLIST.md` — manual verification of trading scenarios
- **Smoke checklist:** `docs/MARKET_TRADING_SMOKE_CHECKLIST.md` — short pre-deploy trading pass
- **Run automated suite:** `npm run test:market-trading` (18 checks)
- **Run AMM-only checks:** `npm run test:market-trading:amm`
- **Run exchange-only checks:** `npm run test:market-trading:exchange`

### Trading Tests In Plain English

#### AMM Trading

This section verifies BUY/SELL behavior for YES/NO outcomes, confirms expected probability movement, and ensures invalid or unauthenticated trade attempts are rejected.

#### Exchange Trading

This section verifies order placement and matching flows, cancellation behavior, and time-in-force rules for GTC, GTD, FOK, and FAK.

### Market Settlement Simulation

A dedicated simulation focused on **settlement correctness** — verifying deferred settlement after provisional resolution, immutable finalization, zero-trade creator refunds, INVALID cost-basis refunds, and dispute-driven re-resolution that settles only the latest outcome.

- **Full checklist:** `docs/MARKET_SETTLEMENT_QA_CHECKLIST.md` — manual verification of settlement scenarios
- **Smoke checklist:** `docs/MARKET_SETTLEMENT_SMOKE_CHECKLIST.md` — short pre-deploy settlement pass
- **Run automated suite:** `npm run test:settlement` (13 checks)
- **Run core settlement checks:** `npm run test:settlement:core`
- **Run INVALID-only checks:** `npm run test:settlement:invalid`
- **Run dispute-only checks:** `npm run test:settlement:dispute`

### Market Probability Simulation

A dedicated simulation focused on **probability correctness** — verifying configured priors, expected post-trade directional movement, normalization for binary markets, consistency between market detail and the probability endpoint, resolved YES pinning, INVALID neutral pinning, and multi-outcome child probabilities.

- **Full checklist:** `docs/MARKET_PROBABILITY_QA_CHECKLIST.md` — manual verification of probability scenarios
- **Smoke checklist:** `docs/MARKET_PROBABILITY_SMOKE_CHECKLIST.md` — short pre-deploy probability pass
- **Run automated suite:** `npm run test:probability` (12 checks)
- **Run initial-prior checks:** `npm run test:probability:initial`
- **Run trading-movement checks:** `npm run test:probability:trading`
- **Run resolution-pinning checks:** `npm run test:probability:resolution`
- **Run multi-outcome checks:** `npm run test:probability:multi`

### Probability Tests In Plain English

#### Initial Priors

This section verifies that new binary and multi-outcome markets expose probabilities that match their configured priors.

#### Trading Movement

This section verifies that YES buys push YES probability upward, NO buys push NO probability upward, and sells move probability back in the opposite direction.

#### Resolution Pinning

This section verifies that resolved YES markets pin to `1 / 0` and INVALID markets pin to `0.5 / 0.5`.

#### Endpoint Sync

This section verifies that the dedicated probability endpoint and the market detail endpoint report the same probabilities for the same market state.

### Market Liquidity Simulation

A dedicated simulation focused on **liquidity correctness** — verifying creator funding locks on creation, portfolio liquidity accounting, low-vs-high liquidity price-impact sensitivity, multi-outcome liquidity aggregation, and immutable post-resolution unlock behavior.

- **Full checklist:** `docs/MARKET_LIQUIDITY_QA_CHECKLIST.md` — manual verification of liquidity scenarios
- **Smoke checklist:** `docs/MARKET_LIQUIDITY_SMOKE_CHECKLIST.md` — short pre-deploy liquidity pass
- **Run automated suite:** `npm run test:liquidity` (11 checks)
- **Run lock-accounting checks:** `npm run test:liquidity:lock`
- **Run liquidity-sensitivity checks:** `npm run test:liquidity:sensitivity`
- **Run multi-outcome liquidity checks:** `npm run test:liquidity:multi`
- **Run unlock/finalization checks:** `npm run test:liquidity:unlock`

### Liquidity Tests In Plain English

#### Liquidity Locking

This section verifies that market creation debits creator balance by the exact funded amount and records the same amount as locked liquidity in portfolio stats.

#### Liquidity Sensitivity

This section verifies that higher-liquidity markets have higher liquidity parameters and smaller probability movement for the same trade size.

#### Multi-Outcome Liquidity

This section verifies that parent market liquidity equals the sum of child liquidities and that child liquidity parameters scale with configured child funding.

#### Liquidity Unlock

This section verifies liquidity stays locked through provisional resolution and unlocks exactly once after immutable finalization.

### Market Portfolio Simulation

A dedicated simulation focused on **portfolio correctness** — verifying baseline payload shape and auth enforcement, position valuation math, reserved BID accounting, created-market liquidity visibility, and AMM/exchange trade classification.

- **Full checklist:** `docs/MARKET_PORTFOLIO_QA_CHECKLIST.md` — manual verification of portfolio scenarios
- **Smoke checklist:** `docs/MARKET_PORTFOLIO_SMOKE_CHECKLIST.md` — short pre-deploy portfolio pass
- **Run automated suite:** `npm run test:portfolio` (7 checks)
- **Run baseline/auth checks:** `npm run test:portfolio:basics`
- **Run valuation checks:** `npm run test:portfolio:positions`
- **Run reserve-accounting checks:** `npm run test:portfolio:reserves`
- **Run created-market checks:** `npm run test:portfolio:created`
- **Run exchange-classification checks:** `npm run test:portfolio:exchange`

### Portfolio Tests In Plain English

#### Basics

This section verifies that authenticated users receive a complete, stable portfolio payload shape, and unauthenticated requests are rejected.

#### Position Valuation

This section verifies per-position math (`currentValue`, `unrealizedPnl`) and aggregate stats totals remain numerically coherent.

#### Reserved Orders

This section verifies open BID reserves are reflected in both `reservedOrders` and `stats.reservedBalance`.

#### Created Markets

This section verifies created open markets are listed and the same funded liquidity appears in `stats.liquidityLocked`.

#### Exchange Classification

This section verifies trade history marks AMM trades as `AMM`, exchange fills as `EXCHANGE`, and correctly assigns `MAKER` or `TAKER` roles.

### Settlement Tests In Plain English

#### Deferred Finalization

This section verifies that provisional resolution does not pay out immediately, and that settlement happens only after immutable finalization.

#### Zero-Trade Refund

This section verifies that when nobody traded on a market, the creator gets the locked liquidity back after finalization.

#### INVALID Refunds

This section verifies that INVALID finalization closes positions and returns traders to their pre-trade cost basis.

#### Dispute Re-Resolution

This section verifies that dispute-driven re-resolution settles only the latest final outcome and does not accidentally pay both sides.

### Creation Tests In Plain English

#### Authentication Setup

This section creates fresh users and verifies they can authenticate so each creation scenario has isolated sessions and deterministic balances.

#### Binary Creation

This section verifies valid BINARY market creation for neutral and skewed priors, and checks that creation responses contain expected market metadata.

#### Multi-Outcome Creation

This section verifies valid MULTI market creation with both 4-outcome and minimal 2-outcome payloads.

#### Validation

This section intentionally sends invalid creation payloads (bad title/description/type/probability/liquidity/url/outcome constraints) and verifies they are rejected.

#### Balance And Funds

This section verifies creation succeeds for valid funded users and rejects oversized market creation when balance is insufficient.

#### Listing

This section verifies newly created markets are visible via list, category filter, and keyword search.

### Business-Flow Tests In Plain English

#### Authentication

This section verifies the full login lifecycle: new accounts can register, sessions are created correctly, users can log in again later, and one user's session never leaks into another user's account state.

#### Markets

This section verifies that markets can be created, listed, filtered, searched, and opened by id. It checks that the most basic discovery flow works from creation all the way to reading details.

#### AMM Trading

This section tests buying and selling through the AMM, confirms that probabilities move after trades, and verifies that invalid or underfunded trades are rejected instead of partially mutating state.

#### Exchange Orders

This section covers order-book behavior: placing BID and ASK orders, matching crossing orders, partial fills, cancellations, and time-based order handling like GTD, FOK, and FAK. It is focused on the exchange path instead of the AMM path.

#### Comments

This section verifies that users can post comments, fetch comments back in the expected order, and that invalid comment payloads are rejected.

#### Market Data

This section checks read-only market data endpoints like probabilities, chart history, and resolution/status views. It makes sure the data needed by the UI stays coherent after trading and resolution activity.

#### Portfolio

This section verifies that positions, trades, and account statistics appear in the authenticated portfolio view and reflect the user's actual market activity.

#### Leaderboard

This section checks that leaderboard endpoints load and support different sort modes such as default ranking, trade activity, and ROI-oriented views.

#### Resolution

This section verifies that markets can be provisionally resolved first, remain frozen while settlement is still pending, and only update balances and portfolio state after immutable finalization. It also verifies that once resolved, the market can no longer accept additional trading.

#### Dispute

This section exercises the deferred-settlement dispute path where a provisional resolution is disputed before any payout happened, the market is re-voted, and only the latest final outcome is applied at finalization time.

#### Edge Cases

This section intentionally sends bad inputs and malformed requests to ensure the APIs fail safely instead of corrupting balances, market state, or session state.

### Money Conservation Tests In Plain English

#### A1 — AMM BUY exactness

The test buys shares through the AMM and checks that the user's balance drops by exactly the same amount the API reports as `totalCost`.

#### A2 — AMM SELL exactness

The test sells shares back to the AMM and checks that the user's balance increases by exactly the sell proceeds.

#### A3 — Round-trip residual

The test buys shares and then immediately sells the same amount, verifying that the net cost is effectively zero aside from tiny allowed rounding noise.

#### A4 — Multi-user sum conservation

The test spreads trades across several users and verifies that the sum of all balance decreases exactly matches the sum of all reported trade costs.

#### A5 — Exchange BID reservation

The test places a BID order and checks that the reserved amount debited from the buyer is exactly `price × shares`.

#### A6 — Exchange cancel refund

The test cancels reserved BID orders and verifies that the exact reserved amount comes back, with no leakage from repeated cancel flows.

#### A7 — Exchange fill zero-sum transfer

The test matches a buyer and seller and verifies that the buyer's payment and seller's proceeds offset exactly, so the fill itself creates no money.

#### B8 — Zero-trade settlement

The test resolves a market with no trades and verifies that the creator gets the full initial liquidity back.

#### B9 — Single-sided market

The test creates a market where only YES is bought, resolves YES, and verifies that the winners are paid correctly while total system money remains conserved.

#### B10 — Creator as active trader

The test puts the creator on both sides of the lifecycle, as market funder and trader, and verifies that payout plus creator refund are still accounted for correctly.

#### B11 — Dispute rollback conservation

The test walks through provisional resolution, dispute, re-vote, and final settlement while checking that the money in the system is conserved at every phase.

#### B12 — Precision drift

The test repeats many tiny buy/sell pairs and verifies that rounding drift stays bounded rather than accumulating into a meaningful balance error.

### Market Lifecycle Simulation

A dedicated simulation focused on **market status transitions and settlement phases** — verifying end-to-end progression through `OPEN`, `CLOSED`, provisional resolution, immutable finalization, INVALID finalization, and dispute-driven re-resolution.

- **Full checklist:** `docs/MARKET_LIFECYCLE_QA_CHECKLIST.md` — manual verification of all lifecycle phases
- **Smoke checklist:** `docs/MARKET_LIFECYCLE_SMOKE_CHECKLIST.md` — short pre-deploy lifecycle regression pass
- **Run automated suite:** `npm run test:lifecycle` (19 checks)
- **Run core lifecycle checks:** `npm run test:lifecycle:core`
- **Run INVALID-only checks:** `npm run test:lifecycle:invalid`
- **Run dispute-only checks:** `npm run test:lifecycle:dispute`

### Lifecycle Tests In Plain English

#### L1/L2 — OPEN creation, expiry auto-close, order cancellation, trading lock

This scenario creates a new market and confirms the creator's liquidity is immediately locked. It then verifies the market is visible as `OPEN` in both the list page and the detail page.

Next, a second user places a BID while the market is still open. The test checks that the reserved cash is deducted right away. After the market passes its end time, the script refreshes market detail so the normal auto-close path runs. It then verifies four things: the market becomes `CLOSED`, the open BID is cancelled, the reserved cash is fully refunded, and both AMM trading and exchange orders are rejected on the closed market.

#### L3/L4 — Provisional resolution stays pending, then finalizes exactly once

This scenario creates a market, has a trader buy YES shares, waits for expiry, and then resolves the market to YES. The important point is that this first resolution is only provisional because the dispute window is still open.

The test checks that after provisional resolution, the creator's liquidity is still locked, the trader's position is still open, and no payout has been credited yet. It also confirms that once the market is marked `RESOLVED`, new trades and orders are blocked.

Then the script backdates `resolutionTime` so the dispute window is treated as expired and triggers finalization through the portfolio endpoint. At that point it verifies that liquidity unlocks, positions close, the winning trader finally gets paid, and a second refresh does not produce any duplicate payout or refund.

#### L5 — INVALID lifecycle refunds the trader's cost basis

This scenario creates a market, has one trader buy YES shares, waits for expiry, and then resolves the market to `INVALID`.

Right after that provisional INVALID resolution, the test checks that the market shows INVALID status and neutral `0.5 / 0.5` probabilities, but still has not refunded the trader yet. Then it forces immutable finalization and verifies the expected INVALID behavior: creator liquidity unlocks, the position closes, and the trader gets back the original amount they paid.

#### L6 — Dispute and re-resolution settle only the latest outcome

This is the most complex lifecycle path. One trader buys YES, another buys NO, the market expires, and the first vote provisionally resolves the market to YES. At this point nobody should be paid yet.

Then the NO trader files a dispute, which moves the market into `DISPUTED`. The first re-vote for NO is not enough to resolve because dispute round 1 requires quorum 2. The second NO vote reaches quorum and re-resolves the market to NO.

Finally, the script forces immutable finalization after the dispute window and verifies that the YES and NO positions both close, but only the latest NO outcome is actually settled. In other words, the NO trader gets the payout, the YES trader does not, and the system does not accidentally pay both resolutions.

### Simulation Smoke Tests

Quick pre-deploy verification without full manual testing:

- **Simulation smoke:** `docs/MANUAL_QA_SMOKE_CHECKLIST.md` — 12-step smoke test for test-simulation.js
- **Creation smoke:** `docs/MARKET_CREATION_SMOKE_CHECKLIST.md` — short smoke test for market creation paths
- **Trading smoke:** `docs/MARKET_TRADING_SMOKE_CHECKLIST.md` — short smoke test for market trading paths
- **Settlement smoke:** `docs/MARKET_SETTLEMENT_SMOKE_CHECKLIST.md` — short smoke test for market settlement paths
- **Probability smoke:** `docs/MARKET_PROBABILITY_SMOKE_CHECKLIST.md` — short smoke test for probability and pricing behavior
- **Liquidity smoke:** `docs/MARKET_LIQUIDITY_SMOKE_CHECKLIST.md` — short smoke test for liquidity lock/unlock and sensitivity behavior
- **Portfolio smoke:** `docs/MARKET_PORTFOLIO_SMOKE_CHECKLIST.md` — short smoke test for portfolio payload and accounting behavior
- **Conservation smoke:** `docs/MONEY_CONSERVATION_SMOKE_CHECKLIST.md` — 6-check smoke test for money invariants
- **Lifecycle smoke:** `docs/MARKET_LIFECYCLE_SMOKE_CHECKLIST.md` — short smoke test for lifecycle transitions
