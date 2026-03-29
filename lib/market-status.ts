import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { settleMarketResolution } from '@/lib/market-settlement'

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

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

  let cancelled = 0

  for (const order of openOrders) {
    // Use updateMany with a status guard so only one concurrent transaction
    // (this one vs. expireStaleUserOrders in auth/me) actually refunds.
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

    if (result.count > 0) {
      cancelled++
      if (order.side === 'BID' && toNumber(order.reservedAmount) > 0) {
        await tx.user.update({
          where: { id: order.userId },
          data: { balance: { increment: toNumber(order.reservedAmount) } },
        })
      }
    }
  }

  return cancelled
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

function isDisputeWindowClosed(resolutionTime: Date, disputeWindowHours: number, now: Date) {
  const disputeWindowMs = Math.max(1, disputeWindowHours || 24) * 60 * 60 * 1000
  return now.getTime() >= resolutionTime.getTime() + disputeWindowMs
}

async function finalizeMarketResolutionIfImmutable(marketId: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: marketId },
      select: {
        id: true,
        status: true,
        resolution: true,
        resolutionTime: true,
        disputeWindowHours: true,
        creatorId: true,
        initialLiquidity: true,
        settledAt: true,
      },
    })

    if (!market) return false
    if (!market.resolutionTime || !market.resolution) return false
    if (!['RESOLVED', 'INVALID'].includes(market.status)) return false
    if (market.settledAt) return false
    if (!isDisputeWindowClosed(market.resolutionTime, market.disputeWindowHours, now)) return false

    const claimed = await tx.market.updateMany({
      where: {
        id: market.id,
        settledAt: null,
        status: { in: ['RESOLVED', 'INVALID'] },
      },
      data: { settledAt: now },
    })

    if (claimed.count === 0) return false

    await settleMarketResolution(tx, {
      marketId: market.id,
      outcome: market.resolution,
      creatorId: market.creatorId,
      initialLiquidity: toNumber(market.initialLiquidity),
      isReResolution: false,
      previousResolutionTime: null,
    })

    return true
  })
}

export async function finalizeImmutableResolutions() {
  const now = new Date()

  const candidates = await prisma.market.findMany({
    where: {
      status: { in: ['RESOLVED', 'INVALID'] },
      settledAt: null,
      resolution: { not: null },
      resolutionTime: { not: null },
    },
    select: {
      id: true,
      resolutionTime: true,
      disputeWindowHours: true,
    },
    orderBy: { resolutionTime: 'asc' },
    take: 100,
  })

  let finalizedCount = 0

  for (const candidate of candidates) {
    if (!candidate.resolutionTime) continue
    if (!isDisputeWindowClosed(candidate.resolutionTime, candidate.disputeWindowHours, now)) continue

    const finalized = await finalizeMarketResolutionIfImmutable(candidate.id, now)
    if (finalized) finalizedCount++
  }

  return { count: finalizedCount }
}

export async function finalizeImmutableResolutionIfReady(marketId: string) {
  const now = new Date()
  const finalized = await finalizeMarketResolutionIfImmutable(marketId, now)
  return { count: finalized ? 1 : 0 }
}