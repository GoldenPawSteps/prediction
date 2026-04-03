import type { Prisma } from '@prisma/client'
import { activeOrderWhere } from '@/lib/order-expiration'
import { roundMoney } from '@/lib/money'

function toNumber(value: unknown, fallback = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

type TxClient = Prisma.TransactionClient

export async function rebalanceAskReservesForOutcome(
  tx: TxClient,
  userId: string,
  marketId: string,
  outcome: 'YES' | 'NO'
) {
  const now = new Date()

  const [position, openAskOrders, user] = await Promise.all([
    tx.position.findUnique({
      where: { userId_marketId_outcome: { userId, marketId, outcome } },
      select: { shares: true },
    }),
    tx.marketOrder.findMany({
      where: {
        userId,
        marketId,
        outcome,
        side: 'ASK',
        status: { in: ['OPEN', 'PARTIAL'] },
        remainingShares: { gt: 0 },
        ...activeOrderWhere(now),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        price: true,
        remainingShares: true,
        reservedAmount: true,
      },
    }),
    tx.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    }),
  ])

  if (!user || openAskOrders.length === 0) return

  let remainingLongShares = Math.max(0, toNumber(position?.shares))
  const updates: Array<{ id: string; targetReservedAmount: number; currentReservedAmount: number }> = []
  let totalReserveDelta = 0

  for (const order of openAskOrders) {
    const orderShares = Math.max(0, toNumber(order.remainingShares))
    const coveredShares = Math.min(remainingLongShares, orderShares)
    remainingLongShares -= coveredShares

    const shortOrderShares = orderShares - coveredShares
    const targetReservedAmount = roundMoney(shortOrderShares * (1 - toNumber(order.price)))
    const currentReservedAmount = roundMoney(toNumber(order.reservedAmount))
    const delta = roundMoney(targetReservedAmount - currentReservedAmount)

    if (Math.abs(delta) > 0.0000001) {
      updates.push({ id: order.id, targetReservedAmount, currentReservedAmount })
      totalReserveDelta = roundMoney(totalReserveDelta + delta)
    }
  }

  if (updates.length === 0) return

  if (totalReserveDelta > 0 && toNumber(user.balance) + 0.0000001 < totalReserveDelta) {
    throw new Error('Insufficient balance to maintain short ask collateral')
  }

  for (const update of updates) {
    await tx.marketOrder.update({
      where: { id: update.id },
      data: { reservedAmount: update.targetReservedAmount },
    })
  }

  if (totalReserveDelta > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: totalReserveDelta } },
    })
  } else if (totalReserveDelta < 0) {
    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: Math.abs(totalReserveDelta) } },
    })
  }
}
