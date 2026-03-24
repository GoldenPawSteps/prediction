import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { getMarketProbabilities } from '@/lib/lmsr'

interface ProbabilityData {
  yes: number
  no: number
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const market = await prisma.market.findUnique({
      where: { id },
      select: {
        yesShares: true,
        noShares: true,
        liquidityParam: true,
      },
    })

    if (!market) return apiError('Market not found', 404)

    const probabilities = getMarketProbabilities(market.yesShares, market.noShares, market.liquidityParam)

    return apiSuccess(probabilities as ProbabilityData)
  } catch (err) {
    console.error('Failed to fetch probability:', err)
    return apiError('Failed to fetch probability', 500)
  }
}
