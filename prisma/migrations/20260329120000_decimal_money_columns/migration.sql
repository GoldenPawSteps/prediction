-- Convert financial/share columns from floating-point to fixed decimal.
-- Scale=6 keeps micro-unit precision while remaining efficient.

ALTER TABLE "User"
  ALTER COLUMN "balance" TYPE DECIMAL(30, 6) USING "balance"::DECIMAL(30, 6),
  ALTER COLUMN "balance" SET DEFAULT 1000.0;

ALTER TABLE "Market"
  ALTER COLUMN "yesShares" TYPE DECIMAL(30, 6) USING "yesShares"::DECIMAL(30, 6),
  ALTER COLUMN "noShares" TYPE DECIMAL(30, 6) USING "noShares"::DECIMAL(30, 6),
  ALTER COLUMN "liquidityParam" TYPE DECIMAL(30, 6) USING "liquidityParam"::DECIMAL(30, 6),
  ALTER COLUMN "totalVolume" TYPE DECIMAL(30, 6) USING "totalVolume"::DECIMAL(30, 6),
  ALTER COLUMN "ammVolume" TYPE DECIMAL(30, 6) USING "ammVolume"::DECIMAL(30, 6),
  ALTER COLUMN "exchangeVolume" TYPE DECIMAL(30, 6) USING "exchangeVolume"::DECIMAL(30, 6),
  ALTER COLUMN "initialLiquidity" TYPE DECIMAL(30, 6) USING "initialLiquidity"::DECIMAL(30, 6),
  ALTER COLUMN "yesShares" SET DEFAULT 0,
  ALTER COLUMN "noShares" SET DEFAULT 0,
  ALTER COLUMN "liquidityParam" SET DEFAULT 100.0,
  ALTER COLUMN "totalVolume" SET DEFAULT 0,
  ALTER COLUMN "ammVolume" SET DEFAULT 0,
  ALTER COLUMN "exchangeVolume" SET DEFAULT 0,
  ALTER COLUMN "initialLiquidity" SET DEFAULT 100.0;

ALTER TABLE "Trade"
  ALTER COLUMN "shares" TYPE DECIMAL(30, 6) USING "shares"::DECIMAL(30, 6),
  ALTER COLUMN "price" TYPE DECIMAL(30, 6) USING "price"::DECIMAL(30, 6),
  ALTER COLUMN "totalCost" TYPE DECIMAL(30, 6) USING "totalCost"::DECIMAL(30, 6);

ALTER TABLE "Position"
  ALTER COLUMN "shares" TYPE DECIMAL(30, 6) USING "shares"::DECIMAL(30, 6),
  ALTER COLUMN "avgEntryPrice" TYPE DECIMAL(30, 6) USING "avgEntryPrice"::DECIMAL(30, 6),
  ALTER COLUMN "realizedPnl" TYPE DECIMAL(30, 6) USING "realizedPnl"::DECIMAL(30, 6),
  ALTER COLUMN "shares" SET DEFAULT 0,
  ALTER COLUMN "avgEntryPrice" SET DEFAULT 0,
  ALTER COLUMN "realizedPnl" SET DEFAULT 0;

ALTER TABLE "PriceHistory"
  ALTER COLUMN "yesPrice" TYPE DECIMAL(30, 6) USING "yesPrice"::DECIMAL(30, 6),
  ALTER COLUMN "noPrice" TYPE DECIMAL(30, 6) USING "noPrice"::DECIMAL(30, 6),
  ALTER COLUMN "volume" TYPE DECIMAL(30, 6) USING "volume"::DECIMAL(30, 6),
  ALTER COLUMN "volume" SET DEFAULT 0;

ALTER TABLE "MarketOrder"
  ALTER COLUMN "price" TYPE DECIMAL(30, 6) USING "price"::DECIMAL(30, 6),
  ALTER COLUMN "initialShares" TYPE DECIMAL(30, 6) USING "initialShares"::DECIMAL(30, 6),
  ALTER COLUMN "remainingShares" TYPE DECIMAL(30, 6) USING "remainingShares"::DECIMAL(30, 6),
  ALTER COLUMN "reservedAmount" TYPE DECIMAL(30, 6) USING "reservedAmount"::DECIMAL(30, 6),
  ALTER COLUMN "avgEntryPriceSnapshot" TYPE DECIMAL(30, 6) USING "avgEntryPriceSnapshot"::DECIMAL(30, 6),
  ALTER COLUMN "reservedAmount" SET DEFAULT 0,
  ALTER COLUMN "avgEntryPriceSnapshot" SET DEFAULT 0;

ALTER TABLE "MarketOrderFill"
  ALTER COLUMN "price" TYPE DECIMAL(30, 6) USING "price"::DECIMAL(30, 6),
  ALTER COLUMN "shares" TYPE DECIMAL(30, 6) USING "shares"::DECIMAL(30, 6);
