import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Allow anyone to resolve, no admin check needed (voting drives resolution now)
  const userOrResponse = await requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }

  try {
    const { id: marketId } = await params
    const body = await req.json()
    const { outcome } = body

    if (!['YES', 'NO', 'INVALID'].includes(outcome)) {
      return apiError('Invalid outcome')
    }

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: {
        id: true,
        status: true,
        resolutionTime: true,
        creatorId: true,
        initialLiquidity: true,
      },
    })
    if (!market) return apiError('Market not found', 404)
    if (market.status === 'RESOLVED') return apiError('Market already resolved')
    const isReResolution = market.status === 'DISPUTED'

    // Resolve the market and calculate payouts
    const settlement = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const reversedSettlementTrades = await reversePreviousSettlementIfNeeded(
        tx,
        marketId,
        isReResolution,
        market.resolutionTime
      )

      await tx.market.update({
        where: { id: marketId },
        data: {
          status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED',
          resolution: outcome,
          resolutionTime: new Date(),
        },
      })

      // Record final price history point reflecting resolution
      const finalYesPrice = outcome === 'YES' ? 1.0 : outcome === 'NO' ? 0.0 : 0.5
      const finalNoPrice = 1.0 - finalYesPrice
      await tx.priceHistory.create({
        data: { marketId, yesPrice: finalYesPrice, noPrice: finalNoPrice, volume: 0 },
      })

      let totalPayout = 0

      if (outcome !== 'INVALID') {
        // Pay out winning positions
        const winningOutcome = outcome as 'YES' | 'NO'
        const losingOutcome = outcome === 'YES' ? 'NO' : 'YES'

        const winningPositions = await tx.position.findMany({
          where: { marketId, outcome: winningOutcome, shares: { gt: 0 } },
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
          // Record settlement as a SELL at resolution price (1.0 for winner)
          await tx.trade.create({
            data: {
              userId: position.userId,
              marketId,
              outcome: position.outcome,
              type: 'SELL',
              shares: position.shares,
              price: 1.0,
              totalCost: position.shares,
            },
          })
        }

        // Record loss for losing positions (worth $0 at resolution)
        const losingPositions = await tx.position.findMany({
          where: { marketId, outcome: losingOutcome, shares: { gt: 0 } },
        })
        for (const position of losingPositions) {
          const pnl = -(position.avgEntryPrice * position.shares)
          await tx.position.update({
            where: { id: position.id },
            data: { realizedPnl: { increment: pnl } },
          })
          // Record settlement as a SELL at resolution price (0.0 for loser)
          await tx.trade.create({
            data: {
              userId: position.userId,
              marketId,
              outcome: position.outcome,
              type: 'SELL',
              shares: position.shares,
              price: 0.0,
              totalCost: 0.0,
            },
          })
        }
      } else {
        // INVALID: refund based on cost paid
        const positions = await tx.position.findMany({ where: { marketId, shares: { gt: 0 } } })
        for (const position of positions) {
          const refund = position.avgEntryPrice * position.shares
          totalPayout += refund
          await tx.user.update({
            where: { id: position.userId },
            data: { balance: { increment: refund } },
          })
          // Record settlement as a SELL at break-even price (avgEntryPrice)
          await tx.trade.create({
            data: {
              userId: position.userId,
              marketId,
              outcome: position.outcome,
              type: 'SELL',
              shares: position.shares,
              price: position.avgEntryPrice,
              totalCost: refund,
            },
          })
        }
      }

      // Close all positions by zeroing shares (removes them from Open Positions)
      await tx.position.updateMany({
        where: { marketId },
        data: { shares: 0 },
      })

      // Return unused market maker liquidity to the market creator.
      const tradeAggregate = await tx.trade.aggregate({
        where: { marketId },
        _sum: { totalCost: true },
      })
      const netTradeCost = tradeAggregate._sum.totalCost ?? 0
      const remainingLiquidity = market.initialLiquidity + netTradeCost - totalPayout
      const refundedToCreator = Math.max(0, remainingLiquidity)

      if (!isReResolution && refundedToCreator > 0) {
        await tx.user.update({
          where: { id: market.creatorId },
          data: { balance: { increment: refundedToCreator } },
        })
      }

      return {
        reversedSettlementTrades,
        totalPayout,
        netTradeCost,
        refundedToCreator: isReResolution ? 0 : refundedToCreator,
      }
    })

    return apiSuccess({ success: true, outcome, settlement })
  } catch (err) {
    console.error('Resolve market error:', err)
    return apiError('Internal server error', 500)
  }
}

async function reversePreviousSettlementIfNeeded(
  tx: Prisma.TransactionClient,
  marketId: string,
  isReResolution: boolean,
  previousResolutionTime: Date | null
) {
  if (!isReResolution || !previousResolutionTime) return 0

  const settlementTrades = await tx.trade.findMany({
    where: {
      marketId,
      type: 'SELL',
      createdAt: { gte: previousResolutionTime },
      shares: { gt: 0 },
    },
    orderBy: { createdAt: 'asc' },
  })

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
          marketId,
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

    // Keep auditability by writing a compensating trade for the reversed settlement.
    await tx.trade.create({
      data: {
        userId: trade.userId,
        marketId,
        outcome: trade.outcome,
        type: 'BUY',
        shares: trade.shares,
        price: trade.price,
        totalCost: trade.totalCost,
      },
    })
  }

  return settlementTrades.length
}
