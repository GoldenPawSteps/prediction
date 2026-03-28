import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'

export async function GET(req: NextRequest) {
  const userOrResponse = await requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string }

  try {
    const MATCH_EPSILON = 0.000001
    const MATCH_WINDOW_MS = 60000

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

    const fills = await prisma.marketOrderFill.findMany({
      where: {
        OR: [
          { makerUserId: authUser.userId },
          { takerUserId: authUser.userId },
        ],
      },
      select: {
        id: true,
        marketId: true,
        outcome: true,
        price: true,
        shares: true,
        createdAt: true,
        makerUserId: true,
        takerUserId: true,
        makerOrder: { select: { side: true } },
        takerOrder: { select: { side: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const unmatchedFills = [...fills]
    const tradesWithExchangeInfo = trades.map((trade) => {
      const fillIndex = unmatchedFills.findIndex((fill) => {
        if (fill.marketId !== trade.marketId || fill.outcome !== trade.outcome) {
          return false
        }

        if (Math.abs(fill.price - trade.price) > MATCH_EPSILON) return false
        if (Math.abs(fill.shares - trade.shares) > MATCH_EPSILON) return false

        const timeDiff = Math.abs(fill.createdAt.getTime() - trade.createdAt.getTime())
        if (timeDiff > MATCH_WINDOW_MS) return false

        const userIsMaker = fill.makerUserId === authUser.userId
        const userSide = userIsMaker ? fill.makerOrder.side : fill.takerOrder.side
        const tradeTypeMatches =
          (trade.type === 'BUY' && userSide === 'BID') ||
          (trade.type === 'SELL' && userSide === 'ASK')

        return tradeTypeMatches
      })

      if (fillIndex === -1) {
        return {
          ...trade,
          executionVenue: 'AMM' as const,
          exchangeRole: null,
        }
      }

      const [matchedFill] = unmatchedFills.splice(fillIndex, 1)
      return {
        ...trade,
        executionVenue: 'EXCHANGE' as const,
        exchangeRole: matchedFill.makerUserId === authUser.userId ? 'MAKER' as const : 'TAKER' as const,
      }
    })

    const stats = {
      totalPositions: positionsWithValue.length,
      totalValue: positionsWithValue.reduce((sum, p) => sum + p.currentValue, 0),
      totalUnrealizedPnl: positionsWithValue.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      totalRealizedPnl: positions.reduce((sum, p) => sum + p.realizedPnl, 0),
    }

    return apiSuccess({ positions: positionsWithValue, trades: tradesWithExchangeInfo, stats })
  } catch (err) {
    console.error('Portfolio error:', err)
    return apiError('Internal server error', 500)
  }
}
