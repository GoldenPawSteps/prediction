import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sortBy = searchParams.get('sortBy') || 'profit'

    const users = await prisma.user.findMany({
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
    })

    const leaderboard = users.map((user) => {
      const totalRealizedPnl = user.positions.reduce((sum, p) => sum + p.realizedPnl, 0)
      const totalInvested = user.trades
        .filter((t) => t.type === 'BUY')
        .reduce((sum, t) => sum + Math.abs(t.totalCost), 0)
      const roi = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0
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

    return apiSuccess(sorted.slice(0, 100))
  } catch (err) {
    console.error('Leaderboard error:', err)
    return apiError('Internal server error', 500)
  }
}
