import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'

export async function GET(req: NextRequest) {
  const userOrResponse = requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string }

  try {
    const positions = await prisma.position.findMany({
      where: { userId: authUser.userId, shares: { gt: 0 } },
      include: {
        market: {
          select: {
            id: true,
            title: true,
            status: true,
            resolution: true,
            yesShares: true,
            noShares: true,
            liquidityParam: true,
            endDate: true,
            category: true,
          },
        },
      },
    })

    const positionsWithValue = positions.map((p) => {
      let currentPrice: number
      if (p.market.status === 'RESOLVED') {
        currentPrice = p.market.resolution === p.outcome ? 1.0 : 0.0
      } else if (p.market.status === 'INVALID') {
        currentPrice = p.avgEntryPrice // break-even (already refunded)
      } else {
        const probs = getMarketProbabilities(p.market.yesShares, p.market.noShares, p.market.liquidityParam)
        currentPrice = p.outcome === 'YES' ? probs.yes : probs.no
      }
      const currentValue = p.shares * currentPrice
      const costBasis = p.avgEntryPrice * p.shares
      const unrealizedPnl = currentValue - costBasis

      return {
        ...p,
        currentPrice,
        currentValue,
        unrealizedPnl,
      }
    })

    const trades = await prisma.trade.findMany({
      where: { userId: authUser.userId },
      include: { market: { select: { id: true, title: true, category: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const stats = {
      totalPositions: positionsWithValue.length,
      totalValue: positionsWithValue.reduce((sum, p) => sum + p.currentValue, 0),
      totalUnrealizedPnl: positionsWithValue.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      totalRealizedPnl: positions.reduce((sum, p) => sum + p.realizedPnl, 0),
    }

    return apiSuccess({ positions: positionsWithValue, trades, stats })
  } catch (err) {
    console.error('Portfolio error:', err)
    return apiError('Internal server error', 500)
  }
}
