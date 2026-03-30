import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { getUserFromRequest } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'
import { closeMarketIfExpired } from '@/lib/market-status'
import { finalizeImmutableResolutionIfReady } from '@/lib/market-status'
import { activeOrderWhere, expireStaleMarketOrders } from '@/lib/order-expiration'

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const viewer = await getUserFromRequest(_req)
    await closeMarketIfExpired(id)
    // Skip finalization here to avoid blocking market detail page loads
    // Finalization runs opportunistically on portfolio/me endpoints instead
    await prisma.$transaction(async (tx: TxClient) => {
      await expireStaleMarketOrders(tx, id)
    })
    const now = new Date()

    const market = await prisma.market.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
        parent: { select: { id: true, title: true, marketType: true } },
        children: {
          select: {
            id: true,
            title: true,
            outcomeName: true,
            status: true,
            resolution: true,
            resolutionTime: true,
            disputeWindowHours: true,
            totalVolume: true,
            ammVolume: true,
            exchangeVolume: true,
            endDate: true,
            yesShares: true,
            noShares: true,
            liquidityParam: true,
            _count: { select: { trades: true, comments: true, disputes: true } },
            resolutionVotes: {
              select: {
                userId: true,
                outcome: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
            },
            disputes: {
              select: {
                id: true,
                proposedOutcome: true,
                status: true,
                reason: true,
                createdAt: true,
                user: { select: { id: true, username: true, avatar: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
            orders: {
              where: { status: { in: ['OPEN', 'PARTIAL'] }, remainingShares: { gt: 0 }, ...activeOrderWhere(now) },
              select: {
                id: true,
                userId: true,
                outcome: true,
                side: true,
                status: true,
                orderType: true,
                price: true,
                initialShares: true,
                remainingShares: true,
                expiresAt: true,
                createdAt: true,
                user: { select: { id: true, username: true, avatar: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
            },
            orderFills: {
              select: {
                id: true,
                outcome: true,
                price: true,
                shares: true,
                createdAt: true,
                makerUser: { select: { id: true, username: true, avatar: true } },
                takerUser: { select: { id: true, username: true, avatar: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        orders: {
          where: { status: { in: ['OPEN', 'PARTIAL'] }, remainingShares: { gt: 0 }, ...activeOrderWhere(now) },
          select: {
            id: true,
            userId: true,
            outcome: true,
            side: true,
            status: true,
            orderType: true,
            price: true,
            initialShares: true,
            remainingShares: true,
            expiresAt: true,
            createdAt: true,
            user: { select: { id: true, username: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        orderFills: {
          select: {
            id: true,
            outcome: true,
            price: true,
            shares: true,
            createdAt: true,
            makerUser: { select: { id: true, username: true, avatar: true } },
            takerUser: { select: { id: true, username: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        resolutionVotes: {
          select: {
            userId: true,
            outcome: true,
            createdAt: true,
            user: { select: { id: true, username: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        voteHistory: {
          select: {
            userId: true,
            outcome: true,
            createdAt: true,
            user: { select: { id: true, username: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        disputes: {
          select: {
            id: true,
            proposedOutcome: true,
            status: true,
            reason: true,
            createdAt: true,
            user: { select: { id: true, username: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        priceHistory: {
          orderBy: { timestamp: 'asc' },
          take: 100,
        },
        comments: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: { select: { trades: true, disputes: true } },
      },
    })

    if (!market) return apiError('Market not found', 404)

    const userOrders = viewer
      ? await prisma.marketOrder.findMany({
          where: { marketId: id, userId: viewer.userId },
          select: {
            id: true,
            userId: true,
            outcome: true,
            side: true,
            status: true,
            orderType: true,
            price: true,
            initialShares: true,
            remainingShares: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        })
      : []

    const userOrderIds = userOrders.map((order) => order.id)

    const [makerFillSums, takerFillSums] = userOrderIds.length > 0
      ? await Promise.all([
          prisma.marketOrderFill.groupBy({
            by: ['makerOrderId'],
            where: { makerOrderId: { in: userOrderIds } },
            _sum: { shares: true },
          }),
          prisma.marketOrderFill.groupBy({
            by: ['takerOrderId'],
            where: { takerOrderId: { in: userOrderIds } },
            _sum: { shares: true },
          }),
        ])
      : [[], []]

    const filledSharesByOrderId = new Map<string, number>()
    for (const fill of makerFillSums) {
      filledSharesByOrderId.set(
        fill.makerOrderId,
        (filledSharesByOrderId.get(fill.makerOrderId) ?? 0) + toNumber(fill._sum.shares)
      )
    }
    for (const fill of takerFillSums) {
      filledSharesByOrderId.set(
        fill.takerOrderId,
        (filledSharesByOrderId.get(fill.takerOrderId) ?? 0) + toNumber(fill._sum.shares)
      )
    }

    const userOrdersWithFilledShares = userOrders.map((order) => ({
      ...order,
      filledShares: filledSharesByOrderId.get(order.id) ?? 0,
    }))

    // Fetch user orders for each child outcome
    const outcomeUserOrders = viewer ? await Promise.all(
      market.children.map(async (child) => ({
        childId: child.id,
        orders: await prisma.marketOrder.findMany({
          where: { marketId: child.id, userId: viewer.userId },
          select: {
            id: true,
            userId: true,
            outcome: true,
            side: true,
            status: true,
            orderType: true,
            price: true,
            initialShares: true,
            remainingShares: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
      }))
    ) : []

    // Build a map of child ID to user orders with filled shares
    const outcomeUserOrdersMap = new Map<string, Array<Record<string, unknown>>>()
    for (const outcomeOrders of outcomeUserOrders) {
      // Get filled shares for these orders
      const orderIds = outcomeOrders.orders.map((o) => o.id)
      const [makerFills, takerFills] = orderIds.length > 0
        ? await Promise.all([
            prisma.marketOrderFill.groupBy({
              by: ['makerOrderId'],
              where: { makerOrderId: { in: orderIds } },
              _sum: { shares: true },
            }),
            prisma.marketOrderFill.groupBy({
              by: ['takerOrderId'],
              where: { takerOrderId: { in: orderIds } },
              _sum: { shares: true },
            }),
          ])
        : [[], []]

      const filledMap = new Map<string, number>()
      for (const fill of makerFills) {
        filledMap.set(fill.makerOrderId, (filledMap.get(fill.makerOrderId) ?? 0) + toNumber(fill._sum.shares))
      }
      for (const fill of takerFills) {
        filledMap.set(fill.takerOrderId, (filledMap.get(fill.takerOrderId) ?? 0) + toNumber(fill._sum.shares))
      }

      outcomeUserOrdersMap.set(
        outcomeOrders.childId,
        outcomeOrders.orders.map((order) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt?.toISOString(),
          expiresAt: order.expiresAt?.toISOString() ?? null,
          outcome: order.outcome as string,
          side: order.side as string,
          status: order.status as string,
          orderType: order.orderType as string | undefined,
          filledShares: filledMap.get(order.id) ?? 0,
        }))
      )
    }

    const probabilities = market.resolution === 'YES'
      ? { yes: 1, no: 0 }
      : market.resolution === 'NO'
      ? { yes: 0, no: 1 }
      : market.resolution === 'INVALID'
      ? { yes: 0.5, no: 0.5 }
      : getMarketProbabilities(
          toNumber(market.yesShares),
          toNumber(market.noShares),
          toNumber(market.liquidityParam)
        )

    const outcomes = market.children.map((child) => ({
      ...child,
      disputeCount: child._count.disputes,
      probabilities: child.resolution === 'YES'
        ? { yes: 1, no: 0 }
        : child.resolution === 'NO'
        ? { yes: 0, no: 1 }
        : child.resolution === 'INVALID'
        ? { yes: 0.5, no: 0.5 }
        : getMarketProbabilities(
            toNumber(child.yesShares),
            toNumber(child.noShares),
            toNumber(child.liquidityParam)
          ),
      userOrders: outcomeUserOrdersMap.get(child.id) ?? [],
    }))

    const totalVolume = market.marketType === 'MULTI'
      ? outcomes.reduce((sum, outcome) => sum + toNumber(outcome.totalVolume), 0)
      : toNumber(market.totalVolume)

    const ammVolume = market.marketType === 'MULTI'
      ? outcomes.reduce((sum, outcome) => sum + toNumber(outcome.ammVolume), 0)
      : toNumber(market.ammVolume)

    const exchangeVolume = market.marketType === 'MULTI'
      ? outcomes.reduce((sum, outcome) => sum + toNumber(outcome.exchangeVolume), 0)
      : toNumber(market.exchangeVolume)

    return apiSuccess({
      ...market,
      totalVolume,
      ammVolume,
      exchangeVolume,
      outcomes,
      userOrders: userOrdersWithFilledShares,
      probabilities,
      disputeCount: market._count.disputes,
    })
  } catch (err) {
    console.error('Get market error:', err)
    return apiError('Internal server error', 500)
  }
}
