import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const market = await prisma.market.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
        priceHistory: {
          orderBy: { timestamp: 'asc' },
          take: 100,
        },
        comments: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: { select: { trades: true } },
      },
    })

    if (!market) return apiError('Market not found', 404)

    const probabilities = market.resolution === 'YES'
      ? { yes: 1, no: 0 }
      : market.resolution === 'NO'
      ? { yes: 0, no: 1 }
      : market.resolution === 'INVALID'
      ? { yes: 0.5, no: 0.5 }
      : getMarketProbabilities(market.yesShares, market.noShares, market.liquidityParam)

    return apiSuccess({ ...market, probabilities })
  } catch (err) {
    console.error('Get market error:', err)
    return apiError('Internal server error', 500)
  }
}
