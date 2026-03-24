# Predictify 🎯

A modern, full-stack **prediction market platform** where users can create, trade, and resolve markets on real-world events.

Built with **Next.js 14**, **TypeScript**, **TailwindCSS**, **PostgreSQL**, and an **LMSR pricing engine**.

![Dark Mode UI](https://img.shields.io/badge/UI-Dark%20Mode-1a1a2e)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-336791)

## Features

- 🔐 **JWT Authentication** — email/password signup & login
- 📊 **LMSR Market Making** — automated liquidity via Logarithmic Market Scoring Rule
- 💰 **Trading System** — buy/sell YES/NO shares with real-time probability updates
- 📈 **Price Charts** — historical probability charts with Recharts
- 👤 **Portfolio** — track open positions, unrealized P&L, trade history
- 🏆 **Leaderboard** — rankings by profit, ROI, and activity
- 🔧 **Admin Panel** — resolve markets as YES, NO, or INVALID
- 💬 **Comments** — market discussion threads
- 🌙 **Dark Mode** — sleek dark UI similar to Polymarket/Kalshi

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# 3. Run database migrations
npx prisma migrate deploy

# 4. (Optional) Seed demo data
npm run seed

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Demo Credentials (after seeding)

| Role  | Email                    | Password   |
|-------|--------------------------|------------|
| Admin | admin@predictify.com     | admin1234  |
| Demo  | demo@predictify.com      | demo1234   |

## Tech Stack

| Layer       | Technology                         |
|-------------|-------------------------------------|
| Frontend    | Next.js 14 (App Router), React 19   |
| Styling     | TailwindCSS v4                      |
| Backend     | Next.js API Routes                  |
| Database    | PostgreSQL + Prisma ORM v7          |
| Auth        | JWT (httpOnly cookies)              |
| Pricing     | LMSR (Logarithmic Market Scoring)   |
| Charts      | Recharts                            |
| Validation  | Zod                                 |

## Documentation

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full deployment instructions, API reference, and architecture overview.

## Create Market API

`POST /api/markets`

Request body example:

```json
{
	"title": "Will BTC close above $120k by Dec 31, 2026?",
	"description": "Resolves YES if BTC/USD spot closes above 120,000 on 2026-12-31 UTC.",
	"category": "Crypto",
	"endDate": "2026-12-31T23:59:00.000Z",
	"resolutionSource": "https://www.coindesk.com/price/bitcoin/",
	"initialLiquidity": 100,
	"priorProbability": 0.62,
	"disputeWindowHours": 24,
	"tags": ["bitcoin", "crypto"]
}
```

Notes:

- `initialLiquidity` must be between `10` and `10000`.
- `priorProbability` is optional (default `0.5`) and must be between `0.01` and `0.99`.
- `priorProbability` sets the AMM's starting YES/NO probabilities before the first trade.
- `initialLiquidity` is treated as the market maker's maximum loss budget.
- The LMSR liquidity parameter is derived as `b = initialLiquidity / -log(min(priorProbability, 1 - priorProbability))`.
