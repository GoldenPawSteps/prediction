# Predictify

<p>
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-149ECA" alt="React 19" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748" alt="Prisma 7" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-336791" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6" alt="TypeScript 5" />
</p>

Real-money-style prediction market platform for creating markets, trading outcomes, and resolving results with transparent lifecycle tooling.

Predictify combines AMM-style pricing (LMSR) with exchange-style order flows, plus comments, disputes, voting, portfolio analytics, and leaderboard views.

## Quick Links

- [Why Predictify](#why-predictify)
- [Get Running in 2 Minutes](#get-running-in-2-minutes)
- [Demo Accounts](#demo-accounts)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Product Screens](#product-screens)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [API Surface](#api-surface)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Roadmap](#roadmap)
- [Deployment](#deployment)

## Why Predictify

- Fast market creation and trading UX with App Router pages and APIs
- End-to-end market lifecycle support: open, close, dispute, resolve
- Multi-mode trading support via AMM and order-book style endpoints
- Portfolio and leaderboard insights out of the box
- Internationalization-ready message catalog in `messages/`

## Get Running in 2 Minutes

Prerequisites: Node.js 20+ and PostgreSQL 15+.

### 1) Install dependencies

```bash
npm install
```

### 2) Set environment variables

```bash
cp .env.example .env
```

Minimum local config:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/predictify?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3001"
NODE_ENV="development"
```

### 3) Generate client and migrate

```bash
npm run db:generate
npm run db:migrate
```

For a fresh local database with seeded demo data, use:

```bash
npm run db:reset
```

### 4) (Optional) Seed demo data

```bash
npm run seed
```

### 5) Start the app

```bash
npm run dev
```

Open `http://localhost:3001`.

## Demo Accounts

Available after `npm run seed`:

- Admin: `admin@predictify.com` / `admin1234`
- Demo: `demo@predictify.com` / `demo1234`

## Features

### Trading & Market Creation

- Create binary markets with configurable liquidity and metadata
- Trade YES/NO outcomes through market and order endpoints
- Track market probabilities and chart data over time

### Trust & Resolution

- Resolution routes for market outcome finalization
- Dispute and voting workflows for contested outcomes
- Admin controls for moderation and resolution actions

### User Insights

- Portfolio views for positions and trade history
- Leaderboard rankings and performance surfaces
- Comments and discussion threads per market

## Tech Stack

- Framework: Next.js 16 (App Router)
- UI: React 19 + Tailwind CSS 4
- Language: TypeScript
- Database: PostgreSQL
- ORM: Prisma 7
- Validation: Zod
- Charts: Recharts

## Product Screens

Add screenshots to `public/screenshots/` and replace these placeholders.

| Screen | Preview | Notes |
|---|---|---|
| Markets | `public/screenshots/markets-desktop.png` | Market discovery and filtering |
| Market Detail | `public/screenshots/market-detail-desktop.png` | Chart, trade panel, comments |
| Portfolio | `public/screenshots/portfolio-desktop.png` | Positions, PnL, history |
| Leaderboard | `public/screenshots/leaderboard-desktop.png` | Rankings and performance |
| Admin | `public/screenshots/admin-desktop.png` | Resolution and moderation |

Example markdown once images are added:

```md
![Markets](public/screenshots/markets-desktop.png)
```

### Screenshot Conventions

- Store all screenshots in `public/screenshots/`
- Use lowercase kebab-case names
- Desktop pattern: `<screen>-desktop.png`
- Mobile pattern: `<screen>-mobile.png`

Suggested filenames:

- `markets-desktop.png`
- `market-detail-desktop.png`
- `portfolio-desktop.png`
- `leaderboard-desktop.png`
- `admin-desktop.png`

## Scripts

Core scripts:

- `npm run dev` - Start dev server on port `3001`
- `npm run build` - Build for production
- `npm run start` - Start production build
- `npm run lint` - Run ESLint
- `npm run seed` - Seed database
- `npm run db:reset` - Reset database and reseed demo data
- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Apply Prisma migrations
- `npm run db:studio` - Open Prisma Studio

Exchange and resolution tests:

- `npm run test:exchange`
- `npm run test:exchange:bid-maker`
- `npm run test:exchange:ask-maker`
- `npm run test:exchange:gtd`
- `npm run test:exchange:fok`
- `npm run test:exchange:fak`
- `npm run test:resolution-refund`
- `npm run test:resolution-reresolution-refund`
- `npm run test:resolution-deferred-finalization`
- `npm run test:simulation`

Additional repository test utilities:

- `node test-auth-fix.js`
- `node test-money-flow-integrity.js`
- `docs/MANUAL_TEST_SIMULATION.md` - comprehensive manual test simulation scenarios and commands

## Troubleshooting

- If `npm run build` fails during auth initialization, ensure `JWT_SECRET` is set.
- After Prisma schema changes, run `npm run db:generate` and restart the dev server.
- If section fetches are interrupted on slow networks, occasional aborted requests can be expected during navigation.

## API Surface

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Markets

- `GET /api/markets`
- `POST /api/markets`
- `GET /api/markets/[id]`
- `POST /api/markets/[id]/chart`
- `POST /api/markets/[id]/comment`
- `GET /api/markets/[id]/comments`
- `POST /api/markets/[id]/probability`
- `POST /api/markets/[id]/trade`
- `POST /api/markets/[id]/order`
- `POST /api/markets/[id]/vote`
- `POST /api/markets/[id]/dispute`
- `POST /api/markets/[id]/resolution`
- `POST /api/markets/[id]/resolve`

### User Data

- `GET /api/portfolio`
- `GET /api/leaderboard`

## Project Structure

```text
app/
  api/               # Route handlers
  auth/              # Login/register pages
  markets/           # Market list/detail/create pages
  portfolio/         # Portfolio pages
  leaderboard/       # Leaderboard page
  admin/             # Admin page
components/          # Shared components and section components
context/             # Auth and i18n providers
lib/                 # Domain logic (auth, LMSR, settlement, helpers)
messages/            # Localization dictionaries
prisma/              # Schema and seed script
```

## Data Model

Primary models:

- `User`, `Market`, `Trade`, `Position`, `Comment`, `PriceHistory`

Resolution and governance:

- `MarketResolutionVote`, `MarketDispute`

Exchange support:

- `MarketOrder`, `MarketOrderFill`

Enums cover market status, trade type/outcome, order side/type/status, and resolution outcomes.

## Roadmap

Near term:

- [ ] Add screenshot assets and finalize product gallery
- [ ] Expand API docs with request/response examples per route
- [ ] Add CI checks for lint + script-based exchange tests
- [ ] Publish seed variants for local demo and staging data

Mid term:

- [ ] Add websocket-powered live market updates for charts and order activity
- [ ] Extend market types beyond binary outcomes
- [ ] Harden dispute/resolution audit logs and reviewer tooling
- [ ] Add role-based admin controls and operational dashboards

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment setup, Docker example, and production workflow.

## Contributor Notes

- Repository-specific guidance is documented in `AGENTS.md`.
- For framework-specific implementation details, consult docs in `node_modules/next/dist/docs/` per repository rules.
