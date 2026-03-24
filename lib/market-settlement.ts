import type { Prisma } from '@prisma/client'

type ResolutionOutcome = 'YES' | 'NO' | 'INVALID'

type SettlementParams = {
  marketId: string
  outcome: ResolutionOutcome
  creatorId: string
  initialLiquidity: number
  isReResolution?: boolean
  previousResolutionTime?: Date | null
}

export type ResolutionSettlement = {
  reversedSettlementTrades: number
  reversedCreatorRefund: number
  totalPayout: number
  netTradeCost: number
  refundedToCreator: number
}

type SettlementReversal = {
  reversedSettlementTrades: number
  reversedCreatorRefund: number
  netTradeCostBeforeSettlement: number | null
}

export async function settleMarketResolution(
  tx: Prisma.TransactionClient,
  params: SettlementParams
): Promise<ResolutionSettlement> {
  const reversal = await reversePreviousSettlementIfNeeded(tx, params)

  const netTradeCostBeforeSettlement = reversal.netTradeCostBeforeSettlement ?? (
    await tx.trade.aggregate({
      where: { marketId: params.marketId },
      _sum: { totalCost: true },
    })
  )._sum.totalCost ?? 0

  let totalPayout = 0

  if (params.outcome !== 'INVALID') {
    const winningOutcome = params.outcome as 'YES' | 'NO'
    const losingOutcome = params.outcome === 'YES' ? 'NO' : 'YES'

    const winningPositions = await tx.position.findMany({
      where: { marketId: params.marketId, outcome: winningOutcome, shares: { gt: 0 } },
    })
    for (const position of winningPositions) {
      totalPayout += position.shares
      await tx.user.update({
        where: { id: position.userId },
        data: { balance: { increment: position.shares } },
      })

      const pnl = position.shares - position.avgEntryPrice * position.shares
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
          shares: position.shares,
          price: 1.0,
          totalCost: position.shares,
        },
      })
    }

    const losingPositions = await tx.position.findMany({
      where: { marketId: params.marketId, outcome: losingOutcome, shares: { gt: 0 } },
    })
    for (const position of losingPositions) {
      const pnl = -(position.avgEntryPrice * position.shares)
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
          shares: position.shares,
          price: 0.0,
          totalCost: 0.0,
        },
      })
    }
  } else {
    const positions = await tx.position.findMany({
      where: { marketId: params.marketId, shares: { gt: 0 } },
    })
    for (const position of positions) {
      const refund = position.avgEntryPrice * position.shares
      totalPayout += refund
      await tx.user.update({
        where: { id: position.userId },
        data: { balance: { increment: refund } },
      })

      await tx.trade.create({
        data: {
          userId: position.userId,
          marketId: params.marketId,
          outcome: position.outcome,
          type: 'SELL',
          shares: position.shares,
          price: position.avgEntryPrice,
          totalCost: refund,
        },
      })
    }
  }

  await tx.position.updateMany({
    where: { marketId: params.marketId },
    data: { shares: 0 },
  })

  const refundedToCreator = Math.max(
    0,
    params.initialLiquidity + netTradeCostBeforeSettlement - totalPayout
  )

  if (refundedToCreator > 0) {
    await tx.user.update({
      where: { id: params.creatorId },
      data: { balance: { increment: refundedToCreator } },
    })
  }

  return {
    reversedSettlementTrades: reversal.reversedSettlementTrades,
    reversedCreatorRefund: reversal.reversedCreatorRefund,
    totalPayout,
    netTradeCost: netTradeCostBeforeSettlement,
    refundedToCreator,
  }
}

async function reversePreviousSettlementIfNeeded(
  tx: Prisma.TransactionClient,
  params: SettlementParams
): Promise<SettlementReversal> {
  if (!params.isReResolution || !params.previousResolutionTime) {
    return {
      reversedSettlementTrades: 0,
      reversedCreatorRefund: 0,
      netTradeCostBeforeSettlement: null,
    }
  }

  const settlementTrades = await tx.trade.findMany({
    where: {
      marketId: params.marketId,
      type: 'SELL',
      createdAt: { gte: params.previousResolutionTime },
      shares: { gt: 0 },
    },
    orderBy: { createdAt: 'asc' },
  })

  const previousTotalPayout = settlementTrades.reduce((sum, trade) => sum + trade.totalCost, 0)
  const tradeAggregateWithSettlement = await tx.trade.aggregate({
    where: { marketId: params.marketId },
    _sum: { totalCost: true },
  })
  const netTradeCostWithSettlement = tradeAggregateWithSettlement._sum.totalCost ?? 0
  const previousNetTradeCostBeforeSettlement = netTradeCostWithSettlement - previousTotalPayout
  const reversedCreatorRefund = Math.max(
    0,
    params.initialLiquidity + previousNetTradeCostBeforeSettlement - previousTotalPayout
  )

  if (reversedCreatorRefund > 0) {
    await tx.user.update({
      where: { id: params.creatorId },
      data: { balance: { decrement: reversedCreatorRefund } },
    })
  }

  for (const trade of settlementTrades) {
    if (trade.totalCost > 0) {
      await tx.user.update({
        where: { id: trade.userId },
        data: { balance: { decrement: trade.totalCost } },
      })
    }

    const position = await tx.position.findUnique({
      where: {
        userId_marketId_outcome: {
          userId: trade.userId,
          marketId: params.marketId,
          outcome: trade.outcome,
        },
      },
      select: { id: true, avgEntryPrice: true },
    })

    if (position) {
      const settlementPnl = (trade.price - position.avgEntryPrice) * trade.shares
      await tx.position.update({
        where: { id: position.id },
        data: {
          shares: { increment: trade.shares },
          realizedPnl: { decrement: settlementPnl },
        },
      })
    }

    await tx.trade.create({
      data: {
        userId: trade.userId,
        marketId: params.marketId,
        outcome: trade.outcome,
        type: 'BUY',
        shares: trade.shares,
        price: trade.price,
        totalCost: trade.totalCost,
      },
    })
  }

  return {
    reversedSettlementTrades: settlementTrades.length,
    reversedCreatorRefund,
    netTradeCostBeforeSettlement: previousNetTradeCostBeforeSettlement,
  }
}