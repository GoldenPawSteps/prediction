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
        resolution: true,
        yesShares: true,
        noShares: true,
        liquidityParam: true,
      },
    })

    if (!market) return apiError('Market not found', 404)

    const probabilities = market.resolution === 'YES'
      ? { yes: 1, no: 0 }
      : market.resolution === 'NO'
      ? { yes: 0, no: 1 }
      : market.resolution === 'INVALID'
      ? { yes: 0.5, no: 0.5 }
      : getMarketProbabilities(
          Number(market.yesShares),
          Number(market.noShares),
          Number(market.liquidityParam)
        )

    return apiSuccess(probabilities as ProbabilityData)
  } catch (err) {
    console.error('Failed to fetch probability:', err)
    return apiError('Failed to fetch probability', 500)
  }
}
