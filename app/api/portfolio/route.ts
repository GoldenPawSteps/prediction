import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'
import { activeOrderWhere } from '@/lib/order-expiration'
import { finalizeImmutableResolutions } from '@/lib/market-status'
import { computeAskAllocation, type AskOrderInput } from '@/lib/order-reserve-rebalance'
import { getRequiredShortCollateralFromPositions } from '@/lib/position-accounting'

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

    const [user, reservedOpenOrders, reservedOrders, createdMarkets, positions, trades, fills, allOpenAskOrders] = await Promise.all([
      prisma.user.findUnique({
        where: { id: authUser.userId },
        select: { balance: true },
      }),
      prisma.marketOrder.aggregate({
        where: {
          userId: authUser.userId,
          status: { in: ['OPEN', 'PARTIAL'] },
          remainingShares: { gt: 0 },
          reservedAmount: { gt: 0 },
          ...activeOrderWhere(now),
        },
        _sum: { reservedAmount: true },
      }),
      // All open orders that have reserved balance (for the "reserved orders" display)
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
      // All open ASK orders for computing per-position locked shares
      prisma.marketOrder.findMany({
        where: {
          userId: authUser.userId,
          side: 'ASK',
          status: { in: ['OPEN', 'PARTIAL'] },
          remainingShares: { gt: 0 },
          ...activeOrderWhere(now),
        },
        select: {
          id: true,
          marketId: true,
          outcome: true,
          price: true,
          remainingShares: true,
          reservedAmount: true,
        },
      }),
    ])

    // Build a map: (marketId, outcome) → ask orders for locked-share computation
    type AskOrderRaw = { id: string; marketId: string; outcome: string; price: unknown; remainingShares: unknown; reservedAmount: unknown }
    const askOrdersByKey = new Map<string, AskOrderInput[]>()
    for (const o of (allOpenAskOrders as AskOrderRaw[])) {
      const key = `${o.marketId}:${o.outcome}`
      if (!askOrdersByKey.has(key)) askOrdersByKey.set(key, [])
      askOrdersByKey.get(key)!.push({
        id: o.id,
        price: toNumber(o.price),
        remainingShares: toNumber(o.remainingShares),
        currentReservedAmount: toNumber(o.reservedAmount),
      })
    }

    const longSharesByKey = new Map<string, number>()
    for (const position of positions) {
      const key = `${position.marketId}:${position.outcome}`
      longSharesByKey.set(key, Math.max(0, toNumber(position.shares)))
    }

    const askLockedSharesByOrderId = new Map<string, number>()
    const askBalanceCoveredSharesByOrderId = new Map<string, number>()
    for (const [key, askOrders] of askOrdersByKey.entries()) {
      const longShares = longSharesByKey.get(key) ?? 0
      const { orderAllocations } = computeAskAllocation(longShares, askOrders)
      for (const alloc of orderAllocations) {
        askLockedSharesByOrderId.set(alloc.id, alloc.lockedShares)
        askBalanceCoveredSharesByOrderId.set(alloc.id, alloc.uncoveredShares)
      }
    }

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

      // Compute locked / available shares for this position
      const askKey = `${p.marketId}:${p.outcome}`
      const askOrders = askOrdersByKey.get(askKey) ?? []
      const posLong = Math.max(0, shares)
      const { totalLockedShares } = computeAskAllocation(posLong, askOrders)
      const lockedShares = Math.min(totalLockedShares, posLong)
      const availableShares = posLong - lockedShares

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

    const shortReservesByMarket = new Map<string, {
      marketId: string
      marketTitle: string
      shortYesShares: number
      shortNoShares: number
    }>()

    for (const position of positions) {
      const shares = toNumber(position.shares)
      if (shares >= 0) continue

      const existing = shortReservesByMarket.get(position.marketId) ?? {
        marketId: position.marketId,
        marketTitle: position.market.title,
        shortYesShares: 0,
        shortNoShares: 0,
      }

      if (position.outcome === 'YES') existing.shortYesShares = Math.max(0, -shares)
      else existing.shortNoShares = Math.max(0, -shares)

      shortReservesByMarket.set(position.marketId, existing)
    }

    const shortReserves = Array.from(shortReservesByMarket.values())
      .map((reserve) => ({
        ...reserve,
        reservedAmount: Math.max(reserve.shortYesShares, reserve.shortNoShares),
      }))
      .filter((reserve) => reserve.reservedAmount > 0)

    const shortCollateral = getRequiredShortCollateralFromPositions(
      positions.map((position) => ({
        marketId: position.marketId,
        outcome: position.outcome,
        shares: toNumber(position.shares),
      }))
    )

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
      availableBalance: toNumber(user?.balance),
      shortCollateral: 0,
      lockedBalance: 0,
      totalBalance: 0,
      reservedBalance: 0,
      liquidityLocked: createdMarkets.reduce((sum, m) => sum + toNumber(m.initialLiquidity), 0),
      totalPositions: positionsWithValue.length,
      totalValue: positionsWithValue.reduce((sum, p) => sum + p.currentValue, 0),
      totalUnrealizedPnl: positionsWithValue.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      totalRealizedPnl: positionsWithValue.reduce((sum, p) => sum + p.realizedPnl, 0),
    }

    // reservedBalance = open order reserves only (BID + ASK order collateral)
    stats.reservedBalance = toNumber(reservedOpenOrders._sum.reservedAmount)
    // shortCollateral = payoff reserve required by current negative positions
    stats.shortCollateral = shortCollateral
    // lockedBalance = all locked funds across orders and negative positions
    stats.lockedBalance = stats.reservedBalance + stats.shortCollateral
    stats.totalBalance = stats.availableBalance + stats.lockedBalance

    return apiSuccess({
      positions: positionsWithValue,
      trades: tradesWithExchangeInfo,
      reservedOrders: reservedOrders.map((order) => {
        const askLockedShares = askLockedSharesByOrderId.get(order.id) ?? 0
        const askBalanceCoveredShares = askBalanceCoveredSharesByOrderId.get(order.id) ?? 0

        return {
          ...order,
          createdAt: order.createdAt.toISOString(),
          expiresAt: order.expiresAt?.toISOString() ?? null,
          outcome: order.outcome as string,
          side: order.side as string,
          orderType: order.orderType as string,
          reservedShares: order.side === 'ASK' ? askLockedShares : 0,
          balanceCoveredShares: order.side === 'ASK' ? askBalanceCoveredShares : 0,
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
