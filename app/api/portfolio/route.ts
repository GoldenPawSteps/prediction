import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'
import { activeOrderWhere } from '@/lib/order-expiration'
import { finalizeImmutableResolutions } from '@/lib/market-status'
import { computeUserReserveFromRows } from '@/lib/simple-reserve'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export async function GET(req: NextRequest) {
  const userOrResponse = await requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string }

  try {
    await finalizeImmutableResolutions()

    const MATCH_EPSILON = 0.000001
    const MATCH_WINDOW_MS = 60000
    const now = new Date()

    const [user, reservedOrders, createdMarkets, positions, trades, fills] = await Promise.all([
      prisma.user.findUnique({
        where: { id: authUser.userId },
        select: { balance: true },
      }),
      prisma.marketOrder.findMany({
        where: {
          userId: authUser.userId,
          status: { in: ['OPEN', 'PARTIAL'] },
          remainingShares: { gt: 0 },
          ...activeOrderWhere(now),
        },
        select: {
          id: true,
          marketId: true,
          outcome: true,
          side: true,
          orderType: true,
          price: true,
          initialShares: true,
          remainingShares: true,
          reservedAmount: true,
          expiresAt: true,
          createdAt: true,
          market: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.market.findMany({
        where: {
          creatorId: authUser.userId,
          OR: [
            { status: { in: ['OPEN', 'CLOSED', 'DISPUTED'] } },
            { status: { in: ['RESOLVED', 'INVALID'] }, settledAt: null },
          ],
          parentMarketId: null,
        },
        select: {
          id: true,
          title: true,
          status: true,
          initialLiquidity: true,
          endDate: true,
          marketType: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.position.findMany({
        where: { userId: authUser.userId, shares: { not: 0 } },
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
      }),
      prisma.trade.findMany({
        where: { userId: authUser.userId },
        include: { market: { select: { id: true, title: true, category: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.marketOrderFill.findMany({
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
      }),
    ])

    const positionsWithValue = positions.map((p) => {
      let currentPrice: number
      if (p.market.status === 'RESOLVED') {
        currentPrice = p.market.resolution === p.outcome ? 1.0 : 0.0
      } else if (p.market.status === 'INVALID') {
        currentPrice = toNumber(p.avgEntryPrice) // break-even (already refunded)
      } else {
        const probs = getMarketProbabilities(
          toNumber(p.market.yesShares),
          toNumber(p.market.noShares),
          toNumber(p.market.liquidityParam)
        )
        currentPrice = p.outcome === 'YES' ? probs.yes : probs.no
      }
      const shares = toNumber(p.shares)
      const avgEntryPrice = toNumber(p.avgEntryPrice)
      const realizedPnl = toNumber(p.realizedPnl)
      const currentValue = shares * currentPrice
      const costBasis = avgEntryPrice * shares
      const unrealizedPnl = currentValue - costBasis

      // Simplified model: no per-order share locks.
      const lockedShares = 0
      const availableShares = Math.max(0, shares)

      return {
        ...p,
        shares,
        avgEntryPrice,
        realizedPnl,
        currentPrice,
        currentValue,
        unrealizedPnl,
        lockedShares,
        availableShares,
      }
    })

    const shortReserves: Array<unknown> = []

    const unmatchedFills = [...fills]
    const tradesWithExchangeInfo = trades.map((trade) => {
      const fillIndex = unmatchedFills.findIndex((fill) => {
        if (fill.marketId !== trade.marketId || fill.outcome !== trade.outcome) {
          return false
        }

        if (Math.abs(toNumber(fill.price) - toNumber(trade.price)) > MATCH_EPSILON) return false
        if (Math.abs(toNumber(fill.shares) - toNumber(trade.shares)) > MATCH_EPSILON) return false

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
      availableBalance: 0,
      shortCollateral: 0,
      lockedBalance: 0,
      totalBalance: toNumber(user?.balance),
      reservedBalance: 0,
      liquidityLocked: createdMarkets.reduce((sum, m) => sum + toNumber(m.initialLiquidity), 0),
      totalPositions: positionsWithValue.length,
      totalValue: positionsWithValue.reduce((sum, p) => sum + p.currentValue, 0),
      totalUnrealizedPnl: positionsWithValue.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      totalRealizedPnl: positionsWithValue.reduce((sum, p) => sum + p.realizedPnl, 0),
    }

    const computedReserve = computeUserReserveFromRows({
      positions: positions.map((p) => ({
        marketId: p.marketId,
        outcome: p.outcome as 'YES' | 'NO',
        shares: p.shares,
      })),
      openOrders: reservedOrders
        .filter((o) => toNumber(o.remainingShares) > 0)
        .map((o) => ({
          marketId: o.marketId,
          outcome: o.outcome as 'YES' | 'NO',
          side: o.side as 'BID' | 'ASK',
          price: o.price,
          remainingShares: o.remainingShares,
        })),
    })

    stats.shortCollateral = 0
    stats.reservedBalance = computedReserve
    stats.lockedBalance = stats.reservedBalance
    stats.availableBalance = stats.totalBalance - stats.lockedBalance

    return apiSuccess({
      positions: positionsWithValue,
      trades: tradesWithExchangeInfo,
      reservedOrders: reservedOrders.map((order) => {
        return {
          ...order,
          createdAt: order.createdAt.toISOString(),
          expiresAt: order.expiresAt?.toISOString() ?? null,
          outcome: order.outcome as string,
          side: order.side as string,
          orderType: order.orderType as string,
          reservedAmount: 0,
          reservedShares: 0,
          balanceCoveredShares: 0,
        }
      }),
      createdMarkets: createdMarkets.map((m) => ({
        ...m,
        endDate: m.endDate.toISOString(),
        status: m.status as string,
        marketType: m.marketType as string,
      })),
      shortReserves,
      stats,
    })
  } catch (err) {
    console.error('Portfolio error:', err)
    return apiError('Internal server error', 500)
  }
}
