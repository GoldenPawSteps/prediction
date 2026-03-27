import type { Prisma } from '@prisma/client'

type TransactionClient = Prisma.TransactionClient

type ExpireStaleOrdersFilter = {
  marketId?: string
  userId?: string
}

async function expireStaleOrders(tx: TransactionClient, filter: ExpireStaleOrdersFilter = {}) {
  const now = new Date()

  const staleOrders = await tx.marketOrder.findMany({
    where: {
      ...(filter.marketId ? { marketId: filter.marketId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      orderType: 'GTD',
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingShares: { gt: 0 },
      expiresAt: { lte: now },
    },
    select: {
      id: true,
      userId: true,
      side: true,
      reservedAmount: true,
    },
  })

  for (const order of staleOrders) {
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

  return staleOrders.length
}

export async function expireStaleMarketOrders(tx: TransactionClient, marketId?: string) {
  return expireStaleOrders(tx, { marketId })
}

export async function expireStaleUserOrders(tx: TransactionClient, userId: string) {
  return expireStaleOrders(tx, { userId })
}

export function activeOrderWhere(now: Date) {
  return {
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: now } },
    ],
  }
}