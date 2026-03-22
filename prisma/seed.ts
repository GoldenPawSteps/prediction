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

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seeding database...')

  // Create admin user
  const adminPassword = await bcrypt.hash('admin1234', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@predictify.com' },
    update: {},
    create: {
      email: 'admin@predictify.com',
      username: 'admin',
      passwordHash: adminPassword,
      balance: 10000,
      isAdmin: true,
      bio: 'Platform administrator',
    },
  })
  console.log(`✅ Admin user: ${admin.email}`)

  // Create demo user
  const demoPassword = await bcrypt.hash('demo1234', 12)
  const demo = await prisma.user.upsert({
    where: { email: 'demo@predictify.com' },
    update: {},
    create: {
      email: 'demo@predictify.com',
      username: 'demo_trader',
      passwordHash: demoPassword,
      balance: 1000,
      bio: 'Demo account for testing',
    },
  })
  console.log(`✅ Demo user: ${demo.email}`)

  // Create sample markets
  const markets = [
    {
      title: 'Will Bitcoin (BTC) exceed $150,000 by December 31, 2026?',
      description:
        'This market resolves YES if the price of Bitcoin (BTC/USD) on any major exchange (Coinbase, Binance, or Kraken) reaches or exceeds $150,000 at any point before the end of December 31, 2026 UTC. Resolves NO otherwise.',
      category: 'Crypto',
      endDate: new Date('2026-12-31T23:59:59Z'),
      resolutionSource: 'https://coinmarketcap.com/currencies/bitcoin/',
      initialLiquidity: 500,
      liquidityParam: 500,
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
      liquidityParam: 300,
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
      liquidityParam: 200,
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
      liquidityParam: 400,
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
      liquidityParam: 350,
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
      liquidityParam: 500,
      tags: ['senate', 'midterms', 'politics', '2026'],
    },
  ]

  // Create markets with price history
  for (const marketData of markets) {
    const existing = await prisma.market.findFirst({
      where: { title: marketData.title },
    })
    if (!existing) {
      const market = await prisma.market.create({
        data: {
          ...marketData,
          creatorId: admin.id,
        },
      })

      // Add initial price history point at 50%
      await prisma.priceHistory.create({
        data: {
          marketId: market.id,
          yesPrice: 0.5,
          noPrice: 0.5,
          volume: 0,
        },
      })

      console.log(`✅ Market: "${market.title.slice(0, 50)}..."`)
    }
  }

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
