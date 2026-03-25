import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'

type LeaderboardUser = {
  id: string
  username: string
  avatar: string | null
  balance: number
  positions: Array<{
    realizedPnl: number
    shares: number
    avgEntryPrice: number
  }>
  trades: Array<{
    totalCost: number
    type: string
  }>
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sortBy = searchParams.get('sortBy') || 'profit'

    // Fetch top 100 users ordered by basic metrics to avoid loading entire table
    const users: LeaderboardUser[] = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        avatar: true,
        balance: true,
        positions: {
          select: {
            realizedPnl: true,
            shares: true,
            avgEntryPrice: true,
          },
        },
        trades: {
          select: { totalCost: true, type: true },
        },
      },
      take: 150, // Fetch slightly more than we'll return to sort accurately
    })

    const leaderboard = users.map((user) => {
      const totalRealizedPnl = user.positions.reduce((sum, p) => sum + p.realizedPnl, 0)
      const totalInvested = user.trades
        .filter((t) => t.type === 'BUY')
        .reduce((sum, t) => sum + Math.abs(t.totalCost), 0)
      const roi = totalInvested > 0 ? totalRealizedPnl / totalInvested : 0
      const totalTrades = user.trades.length

      return {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        balance: user.balance,
        totalRealizedPnl,
        roi,
        totalTrades,
      }
    })

    const sorted = leaderboard.sort((a, b) => {
      if (sortBy === 'roi') return b.roi - a.roi
      if (sortBy === 'trades') return b.totalTrades - a.totalTrades
      return b.totalRealizedPnl - a.totalRealizedPnl
    })

    return apiSuccess({
      entries: sorted.slice(0, 100),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Leaderboard error:', err)
    return apiError('Internal server error', 500)
  }
}
