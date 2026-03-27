import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/api-helpers'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'
import { lmsrLiquidityParamForMaxLoss } from '@/lib/lmsr'
import { lmsrInitialSharesForPrior } from '@/lib/lmsr'
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
  marketType: z.enum(['BINARY', 'MULTI']).default('BINARY'),
  initialLiquidity: z.number().min(10).max(10000).default(100),
  priorProbability: z.number().min(0.01).max(0.99).default(0.5),
  outcomes: z.array(
    z.object({
      name: z.string().min(1).max(80),
      initialLiquidity: z.number().min(10).max(10000),
      priorProbability: z.number().min(0.01).max(0.99),
    })
  ).default([]),
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

    const where: Record<string, unknown> = { parentMarketId: null }
    if (status !== 'all') where.status = status
    if (category) where.category = category
    if (search) where.title = { contains: search, mode: 'insensitive' }

    // Fetch all matching markets (no pagination yet for sorting purposes)
    const allMarkets = await prisma.market.findMany({
      where,
      include: {
        creator: { select: { username: true, avatar: true } },
        children: {
          select: {
            id: true,
            title: true,
            outcomeName: true,
            status: true,
            resolution: true,
            totalVolume: true,
            yesShares: true,
            noShares: true,
            liquidityParam: true,
            endDate: true,
            _count: { select: { trades: true, comments: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { trades: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Calculate actual totalVolume for each market (for MULTI, sum children volumes)
    const marketsWithVolumes = allMarkets.map((m) => ({
      ...m,
      actualTotalVolume: m.marketType === 'MULTI'
        ? m.children.reduce((sum, child) => sum + child.totalVolume, 0)
        : m.totalVolume,
    }))

    // Sort by volume or creation date in memory
    const sortedMarkets = marketsWithVolumes.sort((a, b) => {
      if (sortBy === 'volume') {
        return b.actualTotalVolume - a.actualTotalVolume
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    // Apply pagination after sorting
    const paginatedMarkets = sortedMarkets.slice((page - 1) * limit, page * limit)

    const marketsWithPrices = paginatedMarkets.map((m) => {
      const actualTradeCount = m.marketType === 'MULTI'
        ? m.children.reduce((sum, child) => sum + (child._count?.trades || 0), 0)
        : m._count?.trades || 0

      return {
        ...m,
        totalVolume: m.actualTotalVolume,
        _count: {
          ...m._count,
          trades: actualTradeCount,
        },
        probabilities: m.resolution === 'YES'
          ? { yes: 1, no: 0 }
          : m.resolution === 'NO'
          ? { yes: 0, no: 1 }
          : m.resolution === 'INVALID'
          ? { yes: 0.5, no: 0.5 }
          : getMarketProbabilities(m.yesShares, m.noShares, m.liquidityParam),
        outcomes: m.children.map((child) => ({
          id: child.id,
          title: child.title,
          outcomeName: child.outcomeName,
          status: child.status,
          resolution: child.resolution,
          totalVolume: child.totalVolume,
          endDate: child.endDate,
          _count: child._count,
          probabilities: child.resolution === 'YES'
            ? { yes: 1, no: 0 }
            : child.resolution === 'NO'
            ? { yes: 0, no: 1 }
            : child.resolution === 'INVALID'
            ? { yes: 0.5, no: 0.5 }
            : getMarketProbabilities(child.yesShares, child.noShares, child.liquidityParam),
        })),
      }
    })

    const total = sortedMarkets.length

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

    const {
      title,
      description,
      category,
      endDate,
      resolutionSource,
      marketType,
      initialLiquidity,
      priorProbability,
      outcomes,
      disputeWindowHours,
      tags,
    } = parsed.data

    if (marketType === 'MULTI') {
      if (outcomes.length < 2) {
        return apiError('At least 2 outcomes are required for multi-outcome markets')
      }

      const uniqueOutcomeNames = new Set(outcomes.map((outcome) => outcome.name.trim().toLowerCase()))
      if (uniqueOutcomeNames.size !== outcomes.length) {
        return apiError('Outcome names must be unique')
      }
    }

    const totalInitialLiquidity = marketType === 'MULTI'
      ? outcomes.reduce((sum, outcome) => sum + outcome.initialLiquidity, 0)
      : initialLiquidity

    const user = await prisma.user.findUnique({ where: { id: authUser.userId } })
    if (!user) return apiError('User not found', 404)
    if (user.balance < totalInitialLiquidity) return apiError('Insufficient balance')

    const createMarketInTransaction = async (tx: Prisma.TransactionClient, includeDisputeWindowHours: boolean) => {
      await tx.user.update({
        where: { id: authUser.userId },
        data: { balance: { decrement: totalInitialLiquidity } },
      })

      if (marketType === 'MULTI') {
        const parentBaseData: Prisma.MarketUncheckedCreateInput = {
          title,
          description,
          category,
          marketType: 'MULTI',
          endDate: new Date(endDate),
          resolutionSource,
          initialLiquidity: totalInitialLiquidity,
          creatorId: authUser.userId,
          tags,
        }

        const parentMarketData = includeDisputeWindowHours
          ? ({ ...parentBaseData, disputeWindowHours } as Prisma.MarketUncheckedCreateInput)
          : parentBaseData

        const parent = await tx.market.create({ data: parentMarketData })

        const childMarkets = []
        for (const outcome of outcomes) {
          const childLiquidity = lmsrLiquidityParamForMaxLoss(outcome.initialLiquidity, outcome.priorProbability)
          const { yesShares, noShares } = lmsrInitialSharesForPrior(outcome.priorProbability, childLiquidity)

          const childBaseData: Prisma.MarketUncheckedCreateInput = {
            title: `${title} - ${outcome.name.trim()}`,
            description,
            category,
            marketType: 'BINARY',
            parentMarketId: parent.id,
            outcomeName: outcome.name.trim(),
            endDate: new Date(endDate),
            resolutionSource,
            initialLiquidity: outcome.initialLiquidity,
            liquidityParam: childLiquidity,
            creatorId: authUser.userId,
            yesShares,
            noShares,
            tags,
          }

          const childMarketData = includeDisputeWindowHours
            ? ({ ...childBaseData, disputeWindowHours } as Prisma.MarketUncheckedCreateInput)
            : childBaseData

          const child = await tx.market.create({ data: childMarketData })
          await tx.priceHistory.create({
            data: { marketId: child.id, yesPrice: outcome.priorProbability, noPrice: 1 - outcome.priorProbability },
          })

          childMarkets.push(child)
        }

        return { ...parent, children: childMarkets }
      }

      const liquidityParam = lmsrLiquidityParamForMaxLoss(initialLiquidity, priorProbability)
      const { yesShares, noShares } = lmsrInitialSharesForPrior(priorProbability, liquidityParam)
      const baseMarketData: Prisma.MarketUncheckedCreateInput = {
        title,
        description,
        category,
        marketType: 'BINARY',
        endDate: new Date(endDate),
        resolutionSource,
        initialLiquidity,
        liquidityParam,
        creatorId: authUser.userId,
        yesShares,
        noShares,
        tags,
      }

      const marketData = includeDisputeWindowHours
        ? ({ ...baseMarketData, disputeWindowHours } as Prisma.MarketUncheckedCreateInput)
        : baseMarketData

      const m = await tx.market.create({ data: marketData })

      await tx.priceHistory.create({
        data: { marketId: m.id, yesPrice: priorProbability, noPrice: 1 - priorProbability },
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
