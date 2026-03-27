import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { settleMarketResolution } from '@/lib/market-settlement'

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

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
    const settlement = await prisma.$transaction(async (tx: TxClient) => {
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

      return settleMarketResolution(tx, {
        marketId,
        outcome,
        creatorId: market.creatorId,
        initialLiquidity: market.initialLiquidity,
        isReResolution,
        previousResolutionTime: market.resolutionTime,
      })
    })

    return apiSuccess({ success: true, outcome, settlement })
  } catch (err) {
    console.error('Resolve market error:', err)
    return apiError('Internal server error', 500)
  }
}
