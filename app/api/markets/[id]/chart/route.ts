import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'

interface PriceData {
  priceHistory: Array<{
    timestamp: string
    yesPrice: number
    noPrice: number
  }>
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const priceHistory = await prisma.priceHistory.findMany({
      where: { marketId: id },
      select: {
        timestamp: true,
        yesPrice: true,
        noPrice: true,
      },
      orderBy: { timestamp: 'asc' },
      take: 100,
    })

    // Convert Date objects to ISO strings
    const formattedHistory = priceHistory.map((entry) => ({
      timestamp: entry.timestamp.toISOString(),
      yesPrice: Number(entry.yesPrice),
      noPrice: Number(entry.noPrice),
    }))

    return apiSuccess({
      priceHistory: formattedHistory,
    } as PriceData)
  } catch (err) {
    console.error('Failed to fetch price history:', err)
    return apiError('Failed to fetch price history', 500)
  }
}
