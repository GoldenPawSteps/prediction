import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

async function cancelOpenOrdersForMarkets(tx: Prisma.TransactionClient, marketIds: string[]) {
  if (marketIds.length === 0) {
    return 0
  }

  const openOrders = await tx.marketOrder.findMany({
    where: {
      marketId: { in: marketIds },
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingShares: { gt: 0 },
    },
    select: {
      id: true,
      userId: true,
      side: true,
      reservedAmount: true,
    },
  })

  for (const order of openOrders) {
    if (order.side === 'BID' && order.reservedAmount > 0) {
      await tx.user.update({
        where: { id: order.userId },
        data: { balance: { increment: order.reservedAmount } },
      })
    }

    await tx.marketOrder.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        remainingShares: 0,
        reservedAmount: 0,
      },
    })
  }

  return openOrders.length
}

export async function closeExpiredOpenMarkets() {
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const expiredOpenMarkets = await tx.market.findMany({
      where: {
        status: 'OPEN',
        endDate: { lte: now },
      },
      select: { id: true },
    })

    if (expiredOpenMarkets.length === 0) {
      return { count: 0 }
    }

    const marketIds = expiredOpenMarkets.map((market) => market.id)

    const result = await tx.market.updateMany({
      where: {
        id: { in: marketIds },
        status: 'OPEN',
      },
      data: { status: 'CLOSED' },
    })

    await cancelOpenOrdersForMarkets(tx, marketIds)

    return result
  })
}

export async function closeMarketIfExpired(marketId: string) {
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findFirst({
      where: {
        id: marketId,
        status: 'OPEN',
        endDate: { lte: now },
      },
      select: { id: true },
    })

    if (!market) {
      return { count: 0 }
    }

    const result = await tx.market.updateMany({
      where: {
        id: marketId,
        status: 'OPEN',
      },
      data: { status: 'CLOSED' },
    })

    await cancelOpenOrdersForMarkets(tx, [marketId])

    return result
  })
}