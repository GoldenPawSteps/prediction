# Market Creation Test Suite

## Overview

The Market Creation Test Suite (`test-market-creation.js`) provides comprehensive testing for the market creation functionality in Predictify. This test file focuses specifically on validating the market creation API endpoint and related business logic.

## Test Coverage

### 1. **Binary Market Creation** (4 tests)
- ✅ Create binary market with 50% prior probability
- ✅ Verify liquidity parameter and initial share allocation
- ✅ Create binary market with 75% prior (bullish scenarios)
- ✅ Create binary market with 25% prior (bearish scenarios)

### 2. **Multi-Outcome Market Creation** (3 tests)
- ✅ Create multi-outcome market with 4 outcomes (e.g., FIFA World Cup)
- ✅ Verify total initial liquidity is correctly calculated (sum of all outcomes)
- ✅ Create minimal 2-outcome multi-market

### 3. **Validation & Error Handling** (9 tests)
- ✅ Reject market with title too short (< 10 chars)
- ✅ Reject market with title too long (> 200 chars)
- ✅ Reject market with description too short (< 20 chars)
- ✅ Reject invalid market types
- ✅ Reject MULTI markets with only 1 outcome
- ✅ Reject MULTI markets with duplicate outcome names
- ✅ Reject markets with prior probability outside valid range (0.01–0.99)
- ✅ Reject markets with liquidity outside valid range (10–10,000)
- ✅ Reject markets with invalid resolution source URLs

### 4. **Balance & Funds** (3 tests)
- ✅ Verify creator balance decreases after market creation
- ✅ Verify multi-outcome markets deduct total liquidity (sum of all outcomes)
- ✅ Reject market creation with insufficient balance

### 5. **Market Listing** (4 tests)
- ✅ Retrieve created markets from market list
- ✅ Verify correct data structure in market responses
- ✅ Filter markets by category
- ✅ Search markets by title

**Total: 27 tests**

## Running the Tests

### Full Test Suite
```bash
npm run test:market-creation
```

### Individual Sections
```bash
# Authentication setup
npm run test:market-creation:binary

# Binary markets only
npm run test:market-creation:binary

# Multi-outcome markets only
npm run test:market-creation:multi

# Validation tests only
npm run test:market-creation:validation

# Balance and funds tests only
npm run test:market-creation:balance

# Market listing tests only
npm run test:market-creation:listing
```

## Test Data

The test suite creates temporary test users with:
- **Default balance**: 1,000 per user
- **Minimum market liquidity**: 10
- **Maximum market liquidity**: 10,000

Test markets are created with realistic scenarios:
- Cryptocurrency predictions (Bitcoin reaching $100k)
- AI predictions (AGI by 2030)
- Economics predictions (USD reserve currency status)
- Sports predictions (FIFA World Cup winner)

## Requirements

- Node.js 20+
- Running dev server: `npm run dev` (on port 3001)
- PostgreSQL database with migrations applied
- `.env` file with `DATABASE_URL` configured

## Key Features Tested

### Market Types
- **BINARY**: Yes/No predictions with customizable probability priors
- **MULTI**: Multi-outcome markets with 2+ outcomes

### Validation Rules
- **Title**: 10–200 characters
- **Description**: 20+ characters
- **Prior Probability**: 0.01–0.99 (1%–99%)
- **Initial Liquidity**: 10–10,000
- **Outcomes**: Minimum 2 for MULTI, unique names required
- **Resolution Source**: Must be valid URL
- **Dispute Window**: 1–720 hours (defaults to 24)

### Financial Calculations
- LMSR (Logarithmic Market Scoring Rule) liquidity parameter calculation
- Initial share allocation based on prior probability
- Balance deduction for market creation

## Implementation Details

### Architecture
```
test-market-creation.js
├── runAuth()                      # User registration & login
├── runBinaryMarkets()             # Binary market creation tests
├── runMultiOutcomeMarkets()       # Multi-outcome market tests
├── runValidation()                # Input validation tests
├── runBalanceAndFunds()           # Balance handling tests
├── runMarketListing()             # Market retrieval tests
└── main()                         # Test orchestration
```

### Test Utilities
- `request()`: HTTP client with cookie-based authentication
- `CookieJar`: Session state management
- `assert()` / `assertApprox()`: Validation helpers
- `step()` / `section()`: Test organization and reporting

## Troubleshooting

### Server Connection Timeout
If you see "Server did not start within 60 s":
1. Ensure dev server is running: `npm run dev`
2. Check PostgreSQL is running
3. Verify `.env` DATABASE_URL is correct

### Insufficient Balance Errors
The test suite creates multiple markets sequentially. If balance errors appear:
- Tests are working correctly (balance is being properly deducted)
- Increase initial user balance if needed (default: 1,000)

### Database Errors
Ensure migrations are applied:
```bash
npm run db:migrate
npm run db:generate
npm run seed  # Optional: create sample data
```

## Related Tests

- [test-simulation.js](./docs/MANUAL_TEST_SIMULATION.md) - Full end-to-end workflow testing
- [test-money-conservation.js](./docs/PROGRESSIVE_EXAMPLES.md) - Financial invariant validation
- [test-market-lifecycle.js](./docs/PROGRESSIVE_EXAMPLES.md) - Market lifecycle testing

## Future Enhancements

- [ ] Add edge case for extremely large numbers of outcomes
- [ ] Test dispute window configuration
- [ ] Test market tags and categorization
- [ ] Performance benchmarking for large liquidity amounts
- [ ] Test concurrent market creation (race conditions)
