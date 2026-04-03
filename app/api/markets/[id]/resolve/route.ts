import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { settleMarketResolution } from '@/lib/market-settlement'

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

function toNumber(value: unknown, fallback: number = 0): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

async function cancelOpenOrdersForMarket(tx: TxClient, marketId: string) {
  const openOrders = await tx.marketOrder.findMany({
    where: {
      marketId,
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingShares: { gt: 0 },
    },
    select: {
      id: true,
      userId: true,
      reservedAmount: true,
    },
  })

  for (const order of openOrders) {
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

    if (result.count > 0 && toNumber(order.reservedAmount) > 0) {
      await tx.user.update({
        where: { id: order.userId },
        data: { balance: { increment: toNumber(order.reservedAmount) } },
      })
    }
  }
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
    const outcome = body?.outcome
    const definitive = body?.definitive === true

    if (!['YES', 'NO', 'INVALID'].includes(outcome)) {
      return apiError('Invalid outcome')
    }

    if (definitive && !authUser.isAdmin) {
      return apiError('Only admins can perform definitive resolution', 403)
    }

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: {
        id: true,
        status: true,
        creatorId: true,
        initialLiquidity: true,
        settledAt: true,
      },
    })
    if (!market) return apiError('Market not found', 404)
    if ((market.status === 'RESOLVED' || market.status === 'INVALID') && market.settledAt) {
      return apiError('Market already settled')
    }

    const now = new Date()

    if (definitive) {
      await prisma.$transaction(async (tx: TxClient) => {
        await cancelOpenOrdersForMarket(tx, marketId)

        await tx.market.update({
          where: { id: marketId },
          data: {
            status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED',
            resolution: outcome,
            resolutionTime: now,
            settledAt: now,
          },
        })

        const finalYesPrice = outcome === 'YES' ? 1.0 : outcome === 'NO' ? 0.0 : 0.5
        const finalNoPrice = 1.0 - finalYesPrice
        await tx.priceHistory.create({
          data: { marketId, yesPrice: finalYesPrice, noPrice: finalNoPrice, volume: 0 },
        })

        await settleMarketResolution(tx, {
          marketId,
          outcome,
          creatorId: market.creatorId,
          initialLiquidity: toNumber(market.initialLiquidity),
        })
      })

      return apiSuccess({ success: true, outcome, settlementPending: false, definitive: true })
    }

    // Normal non-admin/community resolve remains provisional.
    await prisma.$transaction(async (tx: TxClient) => {
      await tx.market.update({
        where: { id: marketId },
        data: {
          status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED',
          resolution: outcome,
          resolutionTime: now,
          settledAt: null,
        },
      })

      // Record final price history point reflecting resolution
      const finalYesPrice = outcome === 'YES' ? 1.0 : outcome === 'NO' ? 0.0 : 0.5
      const finalNoPrice = 1.0 - finalYesPrice
      await tx.priceHistory.create({
        data: { marketId, yesPrice: finalYesPrice, noPrice: finalNoPrice, volume: 0 },
      })
    })

    return apiSuccess({ success: true, outcome, settlementPending: true, definitive: false })
  } catch (err) {
    console.error('Resolve market error:', err)
    return apiError('Internal server error', 500)
  }
}
