import type { Prisma } from '@prisma/client'

type TransactionClient = Prisma.TransactionClient

/**
 * Atomically cancel an order.
 * Uses `updateMany` with a status guard so only the first concurrent
 * transaction that hits the row actually performs the cancellation.
 */
async function safeCancelAndRefund(
  tx: TransactionClient,
  order: { id: string; userId: string; side: string; reservedAmount: unknown },
) {
  const result = await tx.marketOrder.updateMany({
    where: {
      id: order.id,
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingShares: { gt: 0 },
    },
    data: {
      status: 'CANCELLED',
      remainingShares: 0,
      reservedAmount: 0,
    },
  })

  return result.count
}

/**
 * Cancel expired GTD orders, scoped to a single market.
 */
export async function expireStaleMarketOrders(tx: TransactionClient, marketId?: string) {
  const now = new Date()

  const staleOrders = await tx.marketOrder.findMany({
    where: {
      ...(marketId ? { marketId } : {}),
      orderType: 'GTD',
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingShares: { gt: 0 },
      expiresAt: { lte: now },
    },
    select: { id: true, userId: true, side: true, reservedAmount: true },
  })

  let count = 0
  for (const order of staleOrders) {
    count += await safeCancelAndRefund(tx, order)
  }
  return count
}

/**
 * Cancel ALL stale orders for a given user:
 *  1. GTD orders past their expiresAt
 *  2. Any orders in markets whose endDate has passed (GTC included)
 *
 * This makes GET /api/auth/me self-sufficient for balance freshness —
 * every call processes pending refunds before returning the balance.
 */
export async function expireStaleUserOrders(tx: TransactionClient, userId: string) {
  const now = new Date()

  const staleOrders = await tx.marketOrder.findMany({
    where: {
      userId,
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingShares: { gt: 0 },
      OR: [
        { orderType: 'GTD', expiresAt: { lte: now } },
        { market: { endDate: { lte: now } } },
      ],
    },
    select: { id: true, userId: true, side: true, reservedAmount: true },
  })

  let count = 0
  for (const order of staleOrders) {
    count += await safeCancelAndRefund(tx, order)
  }
  return count
}

export function activeOrderWhere(now: Date) {
  return {
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: now } },
    ],
  }
}