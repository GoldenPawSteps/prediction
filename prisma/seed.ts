/**
 * Seed script for Predictify prediction market platform
 * Creates a demo admin user, regular user, and sample markets
 * 
 * Run with: npx tsx prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { lmsrInitialSharesForPrior, lmsrLiquidityParamForMaxLoss } from '../lib/lmsr'
import { activeOrderWhere } from '../lib/order-expiration'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const ADMIN_INITIAL_BALANCE = 10000
const DEMO_INITIAL_BALANCE = 1000

type SeedMarket = {
  title: string
  description: string
  category: string
  endDate: Date
  resolutionSource: string
  initialLiquidity: number
  priorProbability: number
  status?: 'OPEN' | 'CLOSED' | 'RESOLVED' | 'INVALID' | 'DISPUTED'
  resolution?: 'YES' | 'NO' | 'INVALID'
  resolutionHoursAgo?: number
  disputeWindowHours?: number
  tags: string[]
}

type SeedExchangeOrder = {
  marketTitle: string
  userEmail: string
  outcome: 'YES' | 'NO'
  price: number
  shares: number
  orderType?: 'GTC' | 'GTD'
  expiresAtDaysFromNow?: number
}

type SeedComment = {
  marketTitle: string
  userEmail: string
  content: string
}

const SAMPLE_MARKETS: SeedMarket[] = [
  {
    title: 'Will Bitcoin (BTC) exceed $150,000 by December 31, 2026?',
    description:
      'This market resolves YES if the price of Bitcoin (BTC/USD) on any major exchange (Coinbase, Binance, or Kraken) reaches or exceeds $150,000 at any point before the end of December 31, 2026 UTC. Resolves NO otherwise.',
    category: 'Crypto',
    endDate: new Date('2026-12-31T23:59:59Z'),
    resolutionSource: 'https://coinmarketcap.com/currencies/bitcoin/',
    initialLiquidity: 500,
    priorProbability: 0.36,
    tags: ['bitcoin', 'crypto', '2026'],
  },
  {
    title: 'Will the US Federal Reserve cut interest rates at least 3 times in 2026?',
    description:
      'This market resolves YES if the Federal Open Market Committee (FOMC) votes to cut the federal funds rate target at least 3 times during calendar year 2026. Each 25bps or larger reduction counts as one cut.',
    category: 'Finance',
    endDate: new Date('2026-12-31T23:59:59Z'),
    resolutionSource: 'https://www.federalreserve.gov/monetarypolicy/fomc.htm',
    initialLiquidity: 300,
    priorProbability: 0.54,
    tags: ['fed', 'rates', 'economy'],
  },
  {
    title: 'Will Apple release a foldable iPhone in 2026?',
    description:
      'Resolves YES if Apple Inc. officially announces and begins selling a foldable form-factor iPhone device before December 31, 2026. Rumors and leaks do not count; an official product launch is required.',
    category: 'Tech',
    endDate: new Date('2026-12-31T23:59:59Z'),
    resolutionSource: 'https://www.apple.com/newsroom/',
    initialLiquidity: 200,
    priorProbability: 0.23,
    tags: ['apple', 'iphone', 'tech'],
  },
  {
    title: 'Will SpaceX successfully land humans on Mars before 2030?',
    description:
      'Resolves YES if SpaceX successfully lands at least one human being on the surface of Mars before January 1, 2030. The crew must survive the landing and officially confirmed by SpaceX or a credible space agency.',
    category: 'Science',
    endDate: new Date('2029-12-31T23:59:59Z'),
    resolutionSource: 'https://www.spacex.com/',
    initialLiquidity: 400,
    priorProbability: 0.18,
    tags: ['spacex', 'mars', 'space'],
  },
  {
    title: 'Will Ethereum (ETH) flip Bitcoin (BTC) in market cap by end of 2026?',
    description:
      'Resolves YES if Ethereum\'s total market capitalization exceeds Bitcoin\'s total market capitalization for any continuous 24-hour period before December 31, 2026, as measured by CoinMarketCap.',
    category: 'Crypto',
    endDate: new Date('2026-12-31T23:59:59Z'),
    resolutionSource: 'https://coinmarketcap.com/',
    initialLiquidity: 350,
    priorProbability: 0.21,
    tags: ['ethereum', 'bitcoin', 'flippening'],
  },
  {
    title: 'Will a Democrat win the 2026 US Midterm Senate majority?',
    description:
      'Resolves YES if the Democratic Party wins enough seats in the 2026 US midterm elections to hold or gain a majority in the United States Senate (51 or more seats including independents who caucus with Democrats).',
    category: 'Politics',
    endDate: new Date('2026-11-15T23:59:59Z'),
    resolutionSource: 'https://www.senate.gov/',
    initialLiquidity: 500,
    priorProbability: 0.47,
    tags: ['senate', 'midterms', 'politics', '2026'],
  },
  {
    title: 'Will the SEC approve a spot Solana ETF by June 30, 2026?',
    description:
      'Resolves YES if the U.S. Securities and Exchange Commission approves any spot Solana ETF for U.S. listing by June 30, 2026. Resolves NO if no such approval is granted by the deadline.',
    category: 'Crypto',
    endDate: new Date('2026-02-15T23:59:59Z'),
    resolutionSource: 'https://www.sec.gov/',
    initialLiquidity: 320,
    priorProbability: 0.41,
    status: 'RESOLVED',
    resolution: 'NO',
    resolutionHoursAgo: 3,
    disputeWindowHours: 48,
    tags: ['solana', 'etf', 'sec', 'resolution-demo'],
  },
  {
    title: 'Will NASA launch Artemis III before April 2026?',
    description:
      'Resolves YES if NASA launches Artemis III before April 1, 2026 UTC. Resolves NO otherwise. This demo market is intentionally left in DISPUTED state to showcase re-voting and dispute workflows.',
    category: 'Science',
    endDate: new Date('2026-03-01T23:59:59Z'),
    resolutionSource: 'https://www.nasa.gov/artemis/',
    initialLiquidity: 280,
    priorProbability: 0.29,
    status: 'DISPUTED',
    resolution: 'YES',
    resolutionHoursAgo: 4,
    disputeWindowHours: 72,
    tags: ['nasa', 'artemis', 'dispute-demo'],
  },
  {
    title: 'Did global EV sales exceed 20 million units in 2025?',
    description:
      'Resolves YES if credible industry reports confirm more than 20 million battery-electric and plug-in hybrid vehicles were sold globally during calendar year 2025. This market is seeded as CLOSED to showcase post-expiry pre-resolution voting states.',
    category: 'Finance',
    endDate: new Date('2026-01-10T23:59:59Z'),
    resolutionSource: 'https://www.iea.org/reports/global-ev-outlook-2026',
    initialLiquidity: 260,
    priorProbability: 0.58,
    status: 'CLOSED',
    disputeWindowHours: 24,
    tags: ['ev', 'macro', 'closed-demo'],
  },
]

const SAMPLE_EXCHANGE_ORDERS: SeedExchangeOrder[] = [
  {
    marketTitle: 'Will Bitcoin (BTC) exceed $150,000 by December 31, 2026?',
    userEmail: 'demo@predictify.com',
    outcome: 'YES',
    price: 0.38,
    shares: 18,
  },
  {
    marketTitle: 'Will Bitcoin (BTC) exceed $150,000 by December 31, 2026?',
    userEmail: 'admin@predictify.com',
    outcome: 'YES',
    price: 0.35,
    shares: 22,
    orderType: 'GTD',
    expiresAtDaysFromNow: 14,
  },
  {
    marketTitle: 'Will the US Federal Reserve cut interest rates at least 3 times in 2026?',
    userEmail: 'demo@predictify.com',
    outcome: 'NO',
    price: 0.43,
    shares: 15,
  },
  {
    marketTitle: 'Will Apple release a foldable iPhone in 2026?',
    userEmail: 'admin@predictify.com',
    outcome: 'YES',
    price: 0.27,
    shares: 12,
  },
]

const SAMPLE_COMMENTS: SeedComment[] = [
  {
    marketTitle: 'Will Bitcoin (BTC) exceed $150,000 by December 31, 2026?',
    userEmail: 'demo@predictify.com',
    content: 'Momentum has been strong this quarter, but macro policy still looks like the key risk for a sustained breakout.',
  },
  {
    marketTitle: 'Will Bitcoin (BTC) exceed $150,000 by December 31, 2026?',
    userEmail: 'admin@predictify.com',
    content: 'Reminder: resolution requires any intraday touch >= 150,000 USD on a listed major exchange before the deadline.',
  },
  {
    marketTitle: 'Will NASA launch Artemis III before April 2026?',
    userEmail: 'demo@predictify.com',
    content: 'Program timeline uncertainty is why I challenged the provisional outcome and opened a dispute.',
  },
]

function almostEqual(a: number, b: number, tolerance = 0.000001) {
  return Math.abs(a - b) <= tolerance
}

async function ensureMinimumBalance(userId: string, minimumBalance: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true },
  })

  if (!user || user.balance >= minimumBalance) return

  await prisma.user.update({
    where: { id: userId },
    data: { balance: { increment: minimumBalance - user.balance } },
  })
}

async function syncAdminSeedBalance(adminId: string, initialBalance: number) {
  const now = new Date()

  const [lockedMarkets, reservedBidOrders] = await Promise.all([
    prisma.market.findMany({
      where: {
        creatorId: adminId,
        parentMarketId: null,
        OR: [
          { status: { in: ['OPEN', 'CLOSED', 'DISPUTED'] } },
          { status: { in: ['RESOLVED', 'INVALID'] }, settledAt: null },
        ],
      },
      select: { initialLiquidity: true },
    }),
    prisma.marketOrder.aggregate({
      where: {
        userId: adminId,
        side: 'BID',
        status: { in: ['OPEN', 'PARTIAL'] },
        remainingShares: { gt: 0 },
        reservedAmount: { gt: 0 },
        ...activeOrderWhere(now),
      },
      _sum: { reservedAmount: true },
    }),
  ])

  const lockedLiquidity = lockedMarkets.reduce((sum, market) => sum + market.initialLiquidity, 0)
  const reservedAmount = reservedBidOrders._sum.reservedAmount ?? 0
  const expectedBalance = Math.max(0, initialBalance - lockedLiquidity - reservedAmount)

  await prisma.user.update({
    where: { id: adminId },
    data: { balance: expectedBalance },
  })
}

async function ensureSampleMarket(adminId: string, marketData: SeedMarket) {
  const existing = await prisma.market.findFirst({
    where: { title: marketData.title, parentMarketId: null },
    select: {
      id: true,
      title: true,
      yesShares: true,
      noShares: true,
      liquidityParam: true,
      initialLiquidity: true,
      totalVolume: true,
      ammVolume: true,
      exchangeVolume: true,
      _count: {
        select: {
          trades: true,
          positions: true,
          orders: true,
          orderFills: true,
          priceHistory: true,
        },
      },
    },
  })

  const liquidityParam = lmsrLiquidityParamForMaxLoss(marketData.initialLiquidity, marketData.priorProbability)
  const { yesShares, noShares } = lmsrInitialSharesForPrior(marketData.priorProbability, liquidityParam)
  const status = marketData.status ?? 'OPEN'
  const disputeWindowHours = marketData.disputeWindowHours ?? 24
  const resolutionTime = marketData.resolutionHoursAgo != null
    ? new Date(Date.now() - marketData.resolutionHoursAgo * 60 * 60 * 1000)
    : null

  if (!existing) {
    const market = await prisma.market.create({
      data: {
        title: marketData.title,
        description: marketData.description,
        category: marketData.category,
        endDate: marketData.endDate,
        resolutionSource: marketData.resolutionSource,
        initialLiquidity: marketData.initialLiquidity,
        liquidityParam,
        yesShares,
        noShares,
        status,
        resolution: marketData.resolution ?? null,
        resolutionTime,
        disputeWindowHours,
        settledAt: null,
        creatorId: adminId,
        tags: marketData.tags,
      },
    })

    await prisma.priceHistory.create({
      data: {
        marketId: market.id,
        yesPrice: marketData.priorProbability,
        noPrice: 1 - marketData.priorProbability,
        volume: 0,
      },
    })

    console.log(`✅ Market: "${market.title.slice(0, 50)}..."`)
    return market
  }

  const hasActivity = existing._count.trades > 0
    || existing._count.positions > 0
    || existing._count.orders > 0
    || existing._count.orderFills > 0

  const looksLegacy = !hasActivity
    && almostEqual(existing.yesShares, 0)
    && almostEqual(existing.noShares, 0)
    && almostEqual(existing.totalVolume, 0)
    && almostEqual(existing.ammVolume, 0)
    && almostEqual(existing.exchangeVolume, 0)
    && almostEqual(existing.liquidityParam, existing.initialLiquidity)

  if (looksLegacy) {
    await prisma.market.update({
      where: { id: existing.id },
      data: {
        description: marketData.description,
        category: marketData.category,
        endDate: marketData.endDate,
        resolutionSource: marketData.resolutionSource,
        initialLiquidity: marketData.initialLiquidity,
        liquidityParam,
        yesShares,
        noShares,
        status,
        resolution: marketData.resolution ?? null,
        resolutionTime,
        disputeWindowHours,
        settledAt: null,
        creatorId: adminId,
        tags: marketData.tags,
      },
    })

    const initialPriceHistory = await prisma.priceHistory.findFirst({
      where: { marketId: existing.id },
      orderBy: { timestamp: 'asc' },
      select: { id: true, yesPrice: true, noPrice: true, volume: true },
    })

    if (!initialPriceHistory) {
      await prisma.priceHistory.create({
        data: {
          marketId: existing.id,
          yesPrice: marketData.priorProbability,
          noPrice: 1 - marketData.priorProbability,
          volume: 0,
        },
      })
    } else if (
      existing._count.priceHistory === 1
      && almostEqual(initialPriceHistory.volume, 0)
      && almostEqual(initialPriceHistory.yesPrice, 0.5)
      && almostEqual(initialPriceHistory.noPrice, 0.5)
    ) {
      await prisma.priceHistory.update({
        where: { id: initialPriceHistory.id },
        data: {
          yesPrice: marketData.priorProbability,
          noPrice: 1 - marketData.priorProbability,
        },
      })
    }

    console.log(`🔄 Updated legacy sample market: "${existing.title.slice(0, 50)}..."`)
  }

  return prisma.market.findUniqueOrThrow({ where: { id: existing.id } })
}

async function ensureSampleExchangeOrder(
  usersByEmail: Map<string, { id: string }>,
  marketsByTitle: Map<string, { id: string; endDate: Date }>,
  orderData: SeedExchangeOrder,
) {
  const user = usersByEmail.get(orderData.userEmail)
  const market = marketsByTitle.get(orderData.marketTitle)

  if (!user || !market) {
    throw new Error(`Missing seed dependency for exchange order on market: ${orderData.marketTitle}`)
  }

  const orderType = orderData.orderType ?? 'GTC'
  let expiresAt: Date | null = null

  if (orderType === 'GTD') {
    const requestedExpiry = new Date(Date.now() + (orderData.expiresAtDaysFromNow ?? 7) * 24 * 60 * 60 * 1000)
    const latestAllowedExpiry = new Date(market.endDate.getTime() - 60 * 60 * 1000)
    expiresAt = requestedExpiry < latestAllowedExpiry ? requestedExpiry : latestAllowedExpiry

    if (expiresAt <= new Date()) {
      expiresAt = null
    }
  }

  const existing = await prisma.marketOrder.findFirst({
    where: {
      userId: user.id,
      marketId: market.id,
      outcome: orderData.outcome,
      side: 'BID',
      orderType,
      status: { in: ['OPEN', 'PARTIAL'] },
      price: orderData.price,
      initialShares: orderData.shares,
      remainingShares: orderData.shares,
    },
    select: { id: true },
  })

  if (existing) return

  const reservedAmount = orderData.price * orderData.shares
  await ensureMinimumBalance(user.id, reservedAmount)

  await prisma.user.update({
    where: { id: user.id },
    data: { balance: { decrement: reservedAmount } },
  })

  await prisma.marketOrder.create({
    data: {
      userId: user.id,
      marketId: market.id,
      outcome: orderData.outcome,
      side: 'BID',
      orderType,
      status: 'OPEN',
      price: orderData.price,
      initialShares: orderData.shares,
      remainingShares: orderData.shares,
      reservedAmount,
      expiresAt,
    },
  })

  console.log(
    `📘 Seeded ${orderType} BID ${orderData.outcome} order on "${orderData.marketTitle.slice(0, 40)}..." for ${orderData.userEmail}`
  )
}

async function ensureSampleComment(
  usersByEmail: Map<string, { id: string }>,
  marketsByTitle: Map<string, { id: string; endDate: Date }>,
  commentData: SeedComment,
) {
  const user = usersByEmail.get(commentData.userEmail)
  const market = marketsByTitle.get(commentData.marketTitle)

  if (!user || !market) {
    throw new Error(`Missing seed dependency for comment on market: ${commentData.marketTitle}`)
  }

  const existing = await prisma.comment.findFirst({
    where: {
      userId: user.id,
      marketId: market.id,
      content: commentData.content,
    },
    select: { id: true },
  })

  if (existing) return

  await prisma.comment.create({
    data: {
      userId: user.id,
      marketId: market.id,
      content: commentData.content,
    },
  })
}

async function ensureResolutionActivity(
  usersByEmail: Map<string, { id: string }>,
  marketsByTitle: Map<string, { id: string; endDate: Date }>,
) {
  const admin = usersByEmail.get('admin@predictify.com')
  const demo = usersByEmail.get('demo@predictify.com')
  const disputed = marketsByTitle.get('Will NASA launch Artemis III before April 2026?')
  const resolved = marketsByTitle.get('Will the SEC approve a spot Solana ETF by June 30, 2026?')

  if (!admin || !demo || !disputed || !resolved) {
    throw new Error('Missing seed dependencies for resolution activity')
  }

  // Current vote state for each market.
  await prisma.marketResolutionVote.upsert({
    where: { userId_marketId: { userId: admin.id, marketId: disputed.id } },
    update: { outcome: 'NO' },
    create: { userId: admin.id, marketId: disputed.id, outcome: 'NO' },
  })

  await prisma.marketResolutionVote.upsert({
    where: { userId_marketId: { userId: demo.id, marketId: disputed.id } },
    update: { outcome: 'YES' },
    create: { userId: demo.id, marketId: disputed.id, outcome: 'YES' },
  })

  await prisma.marketResolutionVote.upsert({
    where: { userId_marketId: { userId: admin.id, marketId: resolved.id } },
    update: { outcome: 'NO' },
    create: { userId: admin.id, marketId: resolved.id, outcome: 'NO' },
  })

  await prisma.marketResolutionVote.upsert({
    where: { userId_marketId: { userId: demo.id, marketId: resolved.id } },
    update: { outcome: 'NO' },
    create: { userId: demo.id, marketId: resolved.id, outcome: 'NO' },
  })

  const disputedHistoryCount = await prisma.marketVoteHistory.count({ where: { marketId: disputed.id } })
  if (disputedHistoryCount === 0) {
    const now = Date.now()
    await prisma.marketVoteHistory.createMany({
      data: [
        {
          userId: demo.id,
          marketId: disputed.id,
          outcome: 'INVALID',
          createdAt: new Date(now - 2 * 60 * 60 * 1000),
        },
        {
          userId: demo.id,
          marketId: disputed.id,
          outcome: 'YES',
          createdAt: new Date(now - 90 * 60 * 1000),
        },
        {
          userId: admin.id,
          marketId: disputed.id,
          outcome: 'NO',
          createdAt: new Date(now - 75 * 60 * 1000),
        },
      ],
    })
  }

  const resolvedHistoryCount = await prisma.marketVoteHistory.count({ where: { marketId: resolved.id } })
  if (resolvedHistoryCount === 0) {
    const now = Date.now()
    await prisma.marketVoteHistory.createMany({
      data: [
        {
          userId: admin.id,
          marketId: resolved.id,
          outcome: 'NO',
          createdAt: new Date(now - 4 * 60 * 60 * 1000),
        },
        {
          userId: demo.id,
          marketId: resolved.id,
          outcome: 'NO',
          createdAt: new Date(now - 3 * 60 * 60 * 1000),
        },
      ],
    })
  }

  const existingDispute = await prisma.marketDispute.findFirst({
    where: {
      marketId: disputed.id,
      userId: demo.id,
      reason: 'Launch schedule evidence suggests the provisional YES resolution should be reopened for community voting.',
    },
    select: { id: true },
  })

  if (!existingDispute) {
    await prisma.marketDispute.create({
      data: {
        marketId: disputed.id,
        userId: demo.id,
        proposedOutcome: 'NO',
        reason: 'Launch schedule evidence suggests the provisional YES resolution should be reopened for community voting.',
        status: 'OPEN',
      },
    })
  }
}

async function main() {
  console.log('🌱 Seeding database...')

  // Create admin user
  const adminPassword = await bcrypt.hash('admin1234', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@predictify.com' },
    update: {
      username: 'admin',
      passwordHash: adminPassword,
      isAdmin: true,
      bio: 'Platform administrator',
    },
    create: {
      email: 'admin@predictify.com',
      username: 'admin',
      passwordHash: adminPassword,
      balance: ADMIN_INITIAL_BALANCE,
      isAdmin: true,
      bio: 'Platform administrator',
    },
  })
  await ensureMinimumBalance(admin.id, ADMIN_INITIAL_BALANCE)
  console.log(`✅ Admin user: ${admin.email}`)

  // Create demo user
  const demoPassword = await bcrypt.hash('demo1234', 12)
  const demo = await prisma.user.upsert({
    where: { email: 'demo@predictify.com' },
    update: {
      username: 'demo_trader',
      passwordHash: demoPassword,
      bio: 'Demo account for testing',
    },
    create: {
      email: 'demo@predictify.com',
      username: 'demo_trader',
      passwordHash: demoPassword,
      balance: DEMO_INITIAL_BALANCE,
      bio: 'Demo account for testing',
    },
  })
  await ensureMinimumBalance(demo.id, DEMO_INITIAL_BALANCE)
  console.log(`✅ Demo user: ${demo.email}`)

  const usersByEmail = new Map([
    [admin.email, { id: admin.id }],
    [demo.email, { id: demo.id }],
  ])

  const marketsByTitle = new Map<string, { id: string; endDate: Date }>()
  for (const marketData of SAMPLE_MARKETS) {
    const market = await ensureSampleMarket(admin.id, marketData)
    marketsByTitle.set(marketData.title, { id: market.id, endDate: market.endDate })
  }

  for (const orderData of SAMPLE_EXCHANGE_ORDERS) {
    await ensureSampleExchangeOrder(usersByEmail, marketsByTitle, orderData)
  }

  for (const commentData of SAMPLE_COMMENTS) {
    await ensureSampleComment(usersByEmail, marketsByTitle, commentData)
  }

  await ensureResolutionActivity(usersByEmail, marketsByTitle)
  await syncAdminSeedBalance(admin.id, ADMIN_INITIAL_BALANCE)

  console.log('\n✨ Seed complete!')
  console.log('\nDemo credentials:')
  console.log('  Admin: admin@predictify.com / admin1234')
  console.log('  Demo:  demo@predictify.com / demo1234')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
