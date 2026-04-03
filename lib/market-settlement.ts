import type { Prisma } from '@prisma/client'
import { roundMoney, roundPrice } from '@/lib/money'

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function requiredShortCollateral(yesShares: number, noShares: number) {
  const shortYes = Math.max(0, -yesShares)
  const shortNo = Math.max(0, -noShares)
  return roundMoney(Math.max(shortYes, shortNo))
}

async function releaseMarketShortCollateral(tx: Prisma.TransactionClient, marketId: string) {
  const positions = await tx.position.findMany({
    where: { marketId, shares: { not: 0 } },
    select: { userId: true, outcome: true, shares: true },
  })

  const byUser = new Map<string, { yesShares: number; noShares: number }>()
  for (const position of positions) {
    const entry = byUser.get(position.userId) ?? { yesShares: 0, noShares: 0 }
    if (position.outcome === 'YES') entry.yesShares = toNumber(position.shares)
    else entry.noShares = toNumber(position.shares)
    byUser.set(position.userId, entry)
  }

  for (const [userId, exposure] of byUser.entries()) {
    const collateral = requiredShortCollateral(exposure.yesShares, exposure.noShares)
    if (collateral <= 0) continue

    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: collateral } },
    })
  }
}

type ResolutionOutcome = 'YES' | 'NO' | 'INVALID'

type SettlementParams = {
  marketId: string
  outcome: ResolutionOutcome
  creatorId: string
  initialLiquidity: number
}

export type ResolutionSettlement = {
  totalPayout: number
  netTradeCost: number
  refundedToCreator: number
}

export async function settleMarketResolution(
  tx: Prisma.TransactionClient,
  params: SettlementParams
): Promise<ResolutionSettlement> {
  const netTradeCostBeforeSettlement = (
    await tx.trade.aggregate({
      where: { marketId: params.marketId },
      _sum: { totalCost: true },
    })
  )._sum.totalCost ?? 0

  let totalPayout = 0

  if (params.outcome !== 'INVALID') {
    const winningOutcome = params.outcome as 'YES' | 'NO'

    const positions = await tx.position.findMany({
      where: { marketId: params.marketId, shares: { not: 0 } },
    })
    for (const position of positions) {
      const shares = toNumber(position.shares)
      const avgEntryPrice = toNumber(position.avgEntryPrice)
      const payout = roundMoney(position.outcome === winningOutcome ? shares : 0)
      totalPayout = roundMoney(totalPayout + payout)

      if (payout !== 0) {
        await tx.user.update({
          where: { id: position.userId },
          data: { balance: { increment: payout } },
        })
      }

      const pnl = roundMoney(payout - (avgEntryPrice * shares))
      await tx.position.update({
        where: { id: position.id },
        data: { realizedPnl: { increment: pnl } },
      })

      await tx.trade.create({
        data: {
          userId: position.userId,
          marketId: params.marketId,
          outcome: position.outcome,
          type: 'SELL',
          shares,
          price: roundPrice(position.outcome === winningOutcome ? 1.0 : 0.0),
          totalCost: payout,
        },
      })
    }

    await releaseMarketShortCollateral(tx, params.marketId)
  } else {
    const positions = await tx.position.findMany({
      where: { marketId: params.marketId, shares: { not: 0 } },
    })
    for (const position of positions) {
      const shares = toNumber(position.shares)
      const avgEntryPrice = toNumber(position.avgEntryPrice)
      const refund = roundMoney(avgEntryPrice * shares)
      totalPayout = roundMoney(totalPayout + refund)

      if (refund !== 0) {
        await tx.user.update({
          where: { id: position.userId },
          data: { balance: { increment: refund } },
        })
      }

      await tx.trade.create({
        data: {
          userId: position.userId,
          marketId: params.marketId,
          outcome: position.outcome,
          type: 'SELL',
          shares,
          price: roundPrice(avgEntryPrice),
          totalCost: refund,
        },
      })
    }

    await releaseMarketShortCollateral(tx, params.marketId)
  }

  await tx.position.updateMany({
    where: { marketId: params.marketId },
    data: { shares: 0 },
  })

  const refundedToCreator = roundMoney(Math.max(
    0,
    params.initialLiquidity + toNumber(netTradeCostBeforeSettlement) - totalPayout
  ))

  if (refundedToCreator > 0) {
    await tx.user.update({
      where: { id: params.creatorId },
      data: { balance: { increment: refundedToCreator } },
    })
  }

  return {
    totalPayout,
    netTradeCost: toNumber(netTradeCostBeforeSettlement),
    refundedToCreator,
  }
}