# Predictify — Deployment Guide

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- npm or yarn

---

## 1. Clone & Install

```bash
git clone <your-repo-url>
cd prediction
npm install
```

---

## 2. Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/predictify?schema=public"

# JWT secret — use a long random string in production
JWT_SECRET="your-super-secret-jwt-key-change-in-production"

# Application URL
NEXT_PUBLIC_APP_URL="https://your-domain.com"

# Environment
NODE_ENV="production"
```

### Generating a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 3. Database Setup

### Create the database:
```sql
CREATE DATABASE predictify;
```

### Run Prisma migrations:
```bash
npx prisma migrate deploy
```

### (Optional) Seed sample data:
```bash
npx tsx prisma/seed.ts
```

This creates:
- Admin user: `admin@predictify.com` / `admin1234`
- Demo user: `demo@predictify.com` / `demo1234`
- 6 sample prediction markets

---

## 4. Build & Run

### Development:
```bash
npm run dev
```

### Production build:
```bash
npm run build
npm start
```

---

## 5. Deploy to Vercel (Recommended)

1. Push the repo to GitHub
2. Import in [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `NEXT_PUBLIC_APP_URL`
4. Vercel auto-builds on every push

### Database on Vercel: Use [Neon](https://neon.tech) (serverless PostgreSQL):
```env
DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/predictify?sslmode=require"
```

## 5b. Deploy to Railway

1. Create or reuse a Railway project with:
   - one application service for this repo
   - one PostgreSQL service
2. Set environment variables on the application service:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `NEXT_PUBLIC_APP_URL`
   - `NODE_ENV=production`
3. This repo includes [railway.json](/workspaces/prediction/railway.json), and the production `start` script also runs `npm run db:migrate` before booting Next.js. That keeps Railway deployments safe even if the platform ignores the pre-deploy hook.
4. Generate the baseline schema on a brand-new database once with:

```bash
npx prisma migrate deploy
```

5. If your production database was bootstrapped earlier with `prisma db push`, mark the baseline migration as applied one time:

```bash
npx prisma migrate resolve --applied 20260327074500_init
```

---

## 6. Deploy with Docker

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t predictify .
docker run -p 3000:3000 --env-file .env predictify
```

---

## 7. API Routes Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login and get JWT |
| POST | `/api/auth/logout` | — | Clear auth cookie |
| GET | `/api/auth/me` | ✓ | Get current user |
| GET | `/api/markets` | — | List markets (filterable) |
| POST | `/api/markets` | ✓ | Create market |
| GET | `/api/markets/:id` | — | Get market details |
| POST | `/api/markets/:id/trade` | ✓ | Buy/sell shares |
| POST | `/api/markets/:id/resolve` | Admin | Resolve market |
| POST | `/api/markets/:id/comment` | ✓ | Post comment |
| GET | `/api/portfolio` | ✓ | Get user portfolio |
| GET | `/api/leaderboard` | — | Get leaderboard |

### Query Parameters for `GET /api/markets`:
- `search` — filter by title
- `category` — filter by category
- `status` — `OPEN`, `RESOLVED`, `INVALID`, `all` (default: `OPEN`)
- `sortBy` — `createdAt` (default) or `volume`
- `page` — page number (default: 1)
- `limit` — results per page (default: 20)

---

## 8. Architecture

```
prediction/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/
│   │   ├── auth/           # register, login, logout, me
│   │   ├── markets/        # CRUD, trade, resolve, comment
│   │   ├── portfolio/      # User portfolio
│   │   └── leaderboard/    # Rankings
│   ├── markets/            # Market pages (list, detail, create)
│   ├── auth/               # Auth pages (login, register)
│   ├── portfolio/          # Portfolio page
│   ├── leaderboard/        # Leaderboard page
│   ├── admin/              # Admin dashboard
│   └── profile/            # User profile
├── components/             # React components
│   ├── ui/                 # Primitives (Button, Input, Modal, Badge)
│   ├── Navbar.tsx
│   ├── MarketCard.tsx
│   ├── PriceChart.tsx
│   └── TradePanel.tsx
├── context/
│   └── AuthContext.tsx     # Global auth state
├── lib/
│   ├── prisma.ts           # Database client
│   ├── lmsr.ts             # LMSR pricing engine
│   ├── auth.ts             # JWT utilities
│   ├── api-helpers.ts      # Auth guards & response helpers
│   └── utils.ts            # Formatting utilities
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Demo data seeder
└── .env.example            # Environment variable template
```

---

## 9. LMSR Pricing

Predictify uses the **Logarithmic Market Scoring Rule (LMSR)** for automated market making:

```
Cost(q) = b × ln(e^(q_yes/b) + e^(q_no/b))
Price(YES) = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
```

- `b` = liquidity parameter (set by market creator as "initial liquidity")
- Higher `b` → smaller price impact per trade → more liquid market
- Prices always sum to 1.0 and represent probabilities

---

## 10. Database Schema

6 models: `User`, `Market`, `Trade`, `Position`, `Comment`, `PriceHistory`

Run `npx prisma studio` to browse the database in a visual UI.
