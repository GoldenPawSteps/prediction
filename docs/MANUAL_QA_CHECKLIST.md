# Manual QA Checklist (Mapped to `test-simulation.js`)

This checklist mirrors the automated simulation scenarios, but in human steps you can execute manually.

For a faster pre-deploy run, use `docs/MANUAL_QA_SMOKE_CHECKLIST.md`.

## Prerequisites

1. Start services:

```bash
docker start prediction-postgres
npm run db:reset
npm run dev
```

2. Open app at `http://localhost:3001`.
3. Keep browser DevTools open (Network tab) to verify API responses and status codes.
4. Use fresh users per run to avoid collisions.

Suggested users:
- Alice: `alice+manual+<timestamp>@test.com`
- Bob: `bob+manual+<timestamp>@test.com`
- Password: `password123`

## 1) Authentication

1. Register Alice from the register page.
Expected:
- Registration succeeds.
- User is logged in automatically.
- Initial balance is 1000.

2. Register Bob (separate browser profile or after logout/login swap).
Expected:
- New account created.
- Bob identity is distinct from Alice.

3. Login with Alice credentials.
Expected:
- Login succeeds.
- Profile/session reflects Alice.

4. Validate `GET /api/auth/me` in Network tab after login.
Expected:
- `200` with Alice id, username, and balance.

5. Validate session isolation.
Expected:
- Bob session shows Bob in `/api/auth/me`, not Alice.

6. Logout and refresh.
Expected:
- Session is invalidated.
- Auth-only pages/API calls are denied until login.

7. Try duplicate email registration.
Expected:
- Rejected with validation/error response.

8. Try duplicate username registration.
Expected:
- Rejected.

9. Try short password (`123`).
Expected:
- Rejected.

## 2) Markets CRUD

1. Create a binary market as Alice.
Expected:
- Create succeeds.
- Market appears as `OPEN` in market list/detail.

2. Create another binary market as Bob with custom liquidity and category `Crypto`.
Expected:
- Create succeeds.
- Values persisted in response/UI.

3. Create a multi-outcome market.
Expected:
- Create succeeds with all outcomes visible.

4. Open markets list (`GET /api/markets`).
Expected:
- Non-empty list and total count.

5. Filter by category `Crypto`.
Expected:
- Returned markets are only `Crypto`.

6. Search for title keyword from created market.
Expected:
- Matching market appears.

7. Sort by volume.
Expected:
- Request succeeds and ordering updates.

8. Open single market detail (`GET /api/markets/[id]`).
Expected:
- Creator and probability fields present.

9. Open non-existent market id URL.
Expected:
- `404` or equivalent not-found behavior.

10. Attempt create market while logged out.
Expected:
- Rejected (`401/403` or routed to login).

## 3) AMM Trading

1. Buy YES shares on a market as Alice.
Expected:
- Trade succeeds.
- Balance decreases.
- YES probability rises.

2. Buy NO shares as Bob.
Expected:
- Trade succeeds.
- Probability updates accordingly.

3. Sell some YES shares as Alice.
Expected:
- Sell succeeds.
- Balance increases.

4. Try to sell more shares than owned.
Expected:
- Rejected.

5. Try an oversized buy that exceeds balance.
Expected:
- Rejected (insufficient balance).

6. Submit trade against fake market id.
Expected:
- Rejected (not found/invalid market).

7. Submit trade while logged out.
Expected:
- Rejected.

8. Do repeated YES buys and inspect `GET /api/markets/[id]/probability`.
Expected:
- YES > 0.5 after sustained buying.
- YES + NO approximately equals 1.

## 4) Exchange Orders

1. Place GTC BID (e.g. YES, price 0.40, shares 20).
Expected:
- Order accepted as `OPEN`/`PARTIAL`.
- Funds reserved (balance decreases).

2. Place non-crossing GTC ASK from Bob (e.g. YES, price 0.80).
Expected:
- Accepted but no immediate fill.

3. Place crossing BID (e.g. YES, price 0.80).
Expected:
- Immediate fill occurs (`filledShares > 0`).

4. Place a cancellable order and cancel it.
Expected:
- Cancel succeeds.
- Reserved funds are refunded.

5. Place FOK with insufficient liquidity.
Expected:
- Entire order canceled/rejected, no partial execution.

6. Place FAK with partial available liquidity.
Expected:
- Available amount fills.
- Unfilled remainder canceled.

7. Place GTD with future `expiresAt`.
Expected:
- Accepted with stored expiry timestamp.

8. Place GTD with past `expiresAt`.
Expected:
- Rejected.

9. Place order on expired/non-open market.
Expected:
- Rejected.

## 5) Comments

1. Post comment as Alice.
Expected:
- Comment saved with author metadata.

2. Post second comment as Bob.
Expected:
- Both comments visible.

3. List comments (`GET /api/markets/[id]/comments`).
Expected:
- Sorted newest first.

4. Submit empty comment.
Expected:
- Rejected.

5. Submit 501-character comment.
Expected:
- Rejected.

6. Post comment while logged out.
Expected:
- Rejected.

## 6) Market Data

1. Fetch `GET /api/markets/[id]/probability`.
Expected:
- YES and NO values valid and sum to about 1.

2. Fetch `GET /api/markets/[id]/chart`.
Expected:
- Non-empty `priceHistory` with `timestamp`, `yesPrice`, `noPrice`.

3. Fetch `GET /api/markets/[id]/resolution` for open/closed non-resolved market.
Expected:
- Returns status plus votes/disputes arrays.

## 7) Portfolio

1. Open portfolio while logged in as active trader.
Expected:
- Positions list present.
- Trades list present.
- Stats (including total value) present.

2. Inspect a position row/payload.
Expected:
- Contains `currentPrice` and `unrealizedPnl`.

3. Open portfolio while logged out.
Expected:
- Rejected or redirected to login.

## 8) Leaderboard

1. Open default leaderboard.
Expected:
- Entries array loads with timestamp.

2. Sort by trades.
Expected:
- Highest trade count appears first.

3. Sort by ROI.
Expected:
- Request succeeds and ranking updates.

## 9) Resolution and Settlement

1. Create short-expiry market (few seconds), then place YES and NO trades.
Expected:
- Both trades accepted before expiry.

2. After expiry, refresh list/detail so close-expired logic runs.
Expected:
- Market is no longer tradable as OPEN.

3. Vote outcome YES (`POST /api/markets/[id]/vote`).
Expected:
- Vote accepted.
- Market may auto-resolve on first vote based on current rules.

4. Fetch market detail and resolution endpoint.
Expected:
- Status is `RESOLVED`.
- Resolution field equals YES.

5. Verify winner payout effect.
Expected:
- Winning side balance/value reflects settlement.

6. Try trading after resolve.
Expected:
- Rejected.

## 10) Dispute and Re-resolution

1. Create/expire/resolve a test market.
Expected:
- Market initially resolves.

2. File dispute (`POST /api/markets/[id]/dispute`) with reason and proposed opposite outcome.
Expected:
- Dispute created with status `OPEN`.
- Market transitions to `DISPUTED`.

3. Verify rollback behavior after dispute.
Expected:
- Prior settlement effects are reversed per system rules.

4. Submit re-votes from two users toward new outcome.
Expected:
- Votes accepted.
- Quorum/threshold met for dispute round.

5. Confirm market re-resolves to new outcome.
Expected:
- Status returns to `RESOLVED`.
- Resolution reflects re-voted result.

6. Attempt dispute on OPEN market.
Expected:
- Rejected.

## 11) Edge Cases and Validation

1. Send malformed JSON to login endpoint.
Expected:
- Error response (`4xx`/parse error).

2. Create market with too-short title.
Expected:
- Rejected.

3. Create market with too-short description.
Expected:
- Rejected.

4. Place order with price `>= 1`.
Expected:
- Rejected.

5. Place order with price `<= 0`.
Expected:
- Rejected.

6. Submit trade with negative shares.
Expected:
- Rejected.

7. Vote on open/non-expired market.
Expected:
- Rejected.

8. Login with wrong password.
Expected:
- Rejected.

9. Login with non-existent email.
Expected:
- Rejected.

## Pass/Fail Recording Template

For each step record:
- Action performed
- Endpoint and status code
- UI message/toast
- Expected vs actual
- Pass/Fail
- Screenshot or network trace reference

## Recommended Execution Order

1. Auth
2. Markets
3. AMM
4. Exchange
5. Comments
6. Data
7. Portfolio
8. Leaderboard
9. Resolution
10. Dispute
11. Edge
