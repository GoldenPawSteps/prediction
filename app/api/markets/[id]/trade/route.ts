import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { lmsrTradeCost, getMarketProbabilities } from '@/lib/lmsr'
import { z } from 'zod'

const tradeSchema = z.object({
  outcome: z.enum(['YES', 'NO']),
  type: z.enum(['BUY', 'SELL']),
  shares: z.number().positive(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = await requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string; email: string; isAdmin: boolean }

  try {
    const { id: marketId } = await params
    const body = await req.json()
    const parsed = tradeSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message)
    }

    const { outcome, type, shares } = parsed.data

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const market = await tx.market.findUnique({ where: { id: marketId } })
      if (!market) throw new Error('Market not found')
      if (market.status !== 'OPEN') throw new Error('Market is not open for trading')
      if (new Date(market.endDate) <= new Date()) {
        throw new Error('Market has expired and is no longer accepting trades')
      }

      const user = await tx.user.findUnique({ where: { id: authUser.userId } })
      if (!user) throw new Error('User not found')

      const b = market.liquidityParam
      let newYesShares = market.yesShares
      let newNoShares = market.noShares

      if (type === 'BUY') {
        if (outcome === 'YES') newYesShares += shares
        else newNoShares += shares
      } else {
        if (outcome === 'YES') newYesShares -= shares
        else newNoShares -= shares
      }

      if (newYesShares < 0 || newNoShares < 0) throw new Error('Invalid trade: negative shares')

      const tradeCost = lmsrTradeCost(market.yesShares, market.noShares, newYesShares, newNoShares, b)
      const actualPrice = Math.abs(tradeCost) / shares

      if (type === 'BUY' && user.balance < tradeCost) {
        throw new Error('Insufficient balance')
      }

      if (type === 'SELL') {
        const position = await tx.position.findUnique({
          where: { userId_marketId_outcome: { userId: authUser.userId, marketId, outcome } },
        })
        if (!position || position.shares < shares) {
          throw new Error('Insufficient shares to sell')
        }
      }

      // Update user balance (-tradeCost: positive for BUY, negative for SELL since LMSR cost is negative when selling)
      await tx.user.update({
        where: { id: authUser.userId },
        data: { balance: { increment: -tradeCost } },
      })

      // Update market shares
      await tx.market.update({
        where: { id: marketId },
        data: {
          yesShares: newYesShares,
          noShares: newNoShares,
          totalVolume: { increment: Math.abs(tradeCost) },
        },
      })

      // Record trade
      const trade = await tx.trade.create({
        data: {
          userId: authUser.userId,
          marketId,
          outcome,
          type,
          shares,
          price: actualPrice,
          totalCost: tradeCost,
        },
      })

      // Update position
      const existingPosition = await tx.position.findUnique({
        where: { userId_marketId_outcome: { userId: authUser.userId, marketId, outcome } },
      })

      if (type === 'BUY') {
        if (existingPosition) {
          const totalShares = existingPosition.shares + shares
          const avgEntry = (existingPosition.avgEntryPrice * existingPosition.shares + tradeCost) / totalShares
          await tx.position.update({
            where: { id: existingPosition.id },
            data: { shares: totalShares, avgEntryPrice: avgEntry },
          })
        } else {
          await tx.position.create({
            data: {
              userId: authUser.userId,
              marketId,
              outcome,
              shares,
              avgEntryPrice: tradeCost / shares,
            },
          })
        }
      } else {
        if (existingPosition) {
          const newShares = existingPosition.shares - shares
          const realizedPnl = -tradeCost - (existingPosition.avgEntryPrice * shares)
          if (newShares <= 0) {
            await tx.position.delete({ where: { id: existingPosition.id } })
          } else {
            await tx.position.update({
              where: { id: existingPosition.id },
              data: { shares: newShares, realizedPnl: { increment: realizedPnl } },
            })
          }
        }
      }

      // Record price history
      const newProbs = getMarketProbabilities(newYesShares, newNoShares, b)
      await tx.priceHistory.create({
        data: {
          marketId,
          yesPrice: newProbs.yes,
          noPrice: newProbs.no,
          volume: Math.abs(tradeCost),
        },
      })

      return { trade, probabilities: newProbs }
    })

    return apiSuccess(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Trade failed'
    console.error('Trade error:', err)
    return apiError(message, 400)
  }
}
