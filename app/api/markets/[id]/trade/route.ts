import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { lmsrTradeCost, getMarketProbabilities } from '@/lib/lmsr'
import { roundMoney, roundPrice } from '@/lib/money'
import { expireStaleMarketOrders } from '@/lib/order-expiration'
import { applySignedPositionTrade } from '@/lib/position-accounting'
import { z } from 'zod'

// AMM trade handler: buy/sell flow with reservation-aware sell checks.

const tradeSchema = z.object({
  outcome: z.enum(['YES', 'NO']),
  type: z.enum(['BUY', 'SELL']),
  shares: z.number().positive(),
})

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

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
      await expireStaleMarketOrders(tx, marketId)

      const market = await tx.market.findUnique({ where: { id: marketId } })
      if (!market) throw new Error('Market not found')
      if (market.status !== 'OPEN') throw new Error('Market is not open for trading')
      if (new Date(market.endDate) <= new Date()) {
        throw new Error('Market has expired and is no longer accepting trades')
      }

      const user = await tx.user.findUnique({ where: { id: authUser.userId }, select: { id: true } })
      if (!user) throw new Error('User not found')

      const b = toNumber(market.liquidityParam)
      const currentYesShares = toNumber(market.yesShares)
      const currentNoShares = toNumber(market.noShares)
      let newYesShares = currentYesShares
      let newNoShares = currentNoShares

      if (type === 'BUY') {
        if (outcome === 'YES') newYesShares += shares
        else newNoShares += shares
      } else {
        if (outcome === 'YES') newYesShares -= shares
        else newNoShares -= shares
      }

      const tradeCost = roundMoney(
        lmsrTradeCost(currentYesShares, currentNoShares, newYesShares, newNoShares, b)
      )
      const actualPrice = roundPrice(Math.abs(tradeCost) / shares)

      // Update market shares
      await tx.market.update({
        where: { id: marketId },
        data: {
          yesShares: newYesShares,
          noShares: newNoShares,
          totalVolume: { increment: roundMoney(Math.abs(tradeCost)) },
          ammVolume: { increment: roundMoney(Math.abs(tradeCost)) },
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

      const signedDelta = type === 'BUY' ? shares : -shares
      await applySignedPositionTrade(tx, {
        userId: authUser.userId,
        marketId,
        outcome,
        deltaShares: signedDelta,
        executionPrice: actualPrice,
        cashDelta: roundMoney(-tradeCost),
      })

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
