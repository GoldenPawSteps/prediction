import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/api-helpers'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'
import { closeExpiredOpenMarkets } from '@/lib/market-status'
import { z } from 'zod'

function isUnknownDisputeWindowFieldError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Unknown argument `disputeWindowHours`')
}

const createMarketSchema = z.object({
  title: z.string().min(10).max(200),
  description: z.string().min(20),
  category: z.string(),
  endDate: z.string().datetime(),
  resolutionSource: z.string().url(),
  initialLiquidity: z.number().min(10).max(10000).default(100),
  disputeWindowHours: z.number().int().min(1).max(720).default(24),
  tags: z.array(z.string()).default([]),
})

export async function GET(req: NextRequest) {
  try {
    await closeExpiredOpenMarkets()

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const status = searchParams.get('status') || 'OPEN'
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const sortBy = searchParams.get('sortBy') || 'createdAt'

    const where: Record<string, unknown> = {}
    if (status !== 'all') where.status = status
    if (category) where.category = category
    if (search) where.title = { contains: search, mode: 'insensitive' }

    const [markets, total] = await Promise.all([
      prisma.market.findMany({
        where,
        include: {
          creator: { select: { username: true, avatar: true } },
          _count: { select: { trades: true, comments: true } },
        },
        orderBy: sortBy === 'volume' ? { totalVolume: 'desc' } : { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.market.count({ where }),
    ])

    const marketsWithPrices = markets.map((m) => ({
      ...m,
      probabilities: m.resolution === 'YES'
        ? { yes: 1, no: 0 }
        : m.resolution === 'NO'
        ? { yes: 0, no: 1 }
        : m.resolution === 'INVALID'
        ? { yes: 0.5, no: 0.5 }
        : getMarketProbabilities(m.yesShares, m.noShares, m.liquidityParam),
    }))

    return apiSuccess({ markets: marketsWithPrices, total, page, limit })
  } catch (err) {
    console.error('Get markets error:', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  const userOrResponse = await requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string; email: string; isAdmin: boolean }

  try {
    const body = await req.json()
    const parsed = createMarketSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message)
    }

    const { title, description, category, endDate, resolutionSource, initialLiquidity, disputeWindowHours, tags } = parsed.data

    const user = await prisma.user.findUnique({ where: { id: authUser.userId } })
    if (!user) return apiError('User not found', 404)
    if (user.balance < initialLiquidity) return apiError('Insufficient balance')

    const createMarketInTransaction = async (tx: Prisma.TransactionClient, includeDisputeWindowHours: boolean) => {
      await tx.user.update({
        where: { id: authUser.userId },
        data: { balance: { decrement: initialLiquidity } },
      })

      const baseMarketData: Prisma.MarketUncheckedCreateInput = {
        title,
        description,
        category,
        endDate: new Date(endDate),
        resolutionSource,
        initialLiquidity,
        liquidityParam: initialLiquidity,
        creatorId: authUser.userId,
        tags,
      }

      const marketData = includeDisputeWindowHours
        ? ({ ...baseMarketData, disputeWindowHours } as Prisma.MarketUncheckedCreateInput)
        : baseMarketData

      const m = await tx.market.create({ data: marketData })

      await tx.priceHistory.create({
        data: { marketId: m.id, yesPrice: 0.5, noPrice: 0.5 },
      })

      return m
    }

    let market
    try {
      market = await prisma.$transaction(async (tx: Prisma.TransactionClient) => createMarketInTransaction(tx, true))
    } catch (err) {
      if (!isUnknownDisputeWindowFieldError(err)) throw err
      console.warn('Falling back to default dispute window due to stale Prisma client. Run `npx prisma generate` and restart the dev server.')
      market = await prisma.$transaction(async (tx: Prisma.TransactionClient) => createMarketInTransaction(tx, false))
    }

    return apiSuccess({ market }, 201)
  } catch (err) {
    console.error('Create market error:', err)
    return apiError('Internal server error', 500)
  }
}
