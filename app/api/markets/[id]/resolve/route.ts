import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, apiError, apiSuccess } from '@/lib/api-helpers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = requireAdmin(req)
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
        creatorId: true,
        initialLiquidity: true,
      },
    })
    if (!market) return apiError('Market not found', 404)
    if (market.status === 'RESOLVED') return apiError('Market already resolved')

    // Resolve the market and calculate payouts
    const settlement = await prisma.$transaction(async (tx: any) => {
      await tx.market.update({
        where: { id: marketId },
        data: { status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED', resolution: outcome },
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
          where: { marketId, outcome: winningOutcome },
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
        }

        // Record loss for losing positions (worth $0 at resolution)
        const losingPositions = await tx.position.findMany({
          where: { marketId, outcome: losingOutcome },
        })
        for (const position of losingPositions) {
          const pnl = -(position.avgEntryPrice * position.shares)
          await tx.position.update({
            where: { id: position.id },
            data: { realizedPnl: { increment: pnl } },
          })
        }
      } else {
        // INVALID: refund based on cost paid
        const positions = await tx.position.findMany({ where: { marketId } })
        for (const position of positions) {
          const refund = position.avgEntryPrice * position.shares
          totalPayout += refund
          await tx.user.update({
            where: { id: position.userId },
            data: { balance: { increment: refund } },
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

      if (refundedToCreator > 0) {
        await tx.user.update({
          where: { id: market.creatorId },
          data: { balance: { increment: refundedToCreator } },
        })
      }

      return {
        totalPayout,
        netTradeCost,
        refundedToCreator,
      }
    })

    return apiSuccess({ success: true, outcome, settlement })
  } catch (err) {
    console.error('Resolve market error:', err)
    return apiError('Internal server error', 500)
  }
}
