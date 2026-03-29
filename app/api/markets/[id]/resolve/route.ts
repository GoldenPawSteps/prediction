import { NextRequest } from 'next/server'
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
      },
    })
    if (!market) return apiError('Market not found', 404)
    if (market.status === 'RESOLVED' || market.status === 'INVALID') return apiError('Market already resolved')

    // Record a provisional resolution; settlement is deferred until
    // the dispute window has elapsed and resolution is immutable.
    await prisma.$transaction(async (tx) => {
      await tx.market.update({
        where: { id: marketId },
        data: {
          status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED',
          resolution: outcome,
          resolutionTime: new Date(),
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

    return apiSuccess({ success: true, outcome, settlementPending: true })
  } catch (err) {
    console.error('Resolve market error:', err)
    return apiError('Internal server error', 500)
  }
}
