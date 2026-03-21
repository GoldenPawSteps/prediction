import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, apiError, apiSuccess } from '@/lib/api-helpers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = requireAdmin(req)
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

    const market = await prisma.market.findUnique({ where: { id: marketId } })
    if (!market) return apiError('Market not found', 404)
    if (market.status === 'RESOLVED') return apiError('Market already resolved')

    // Resolve the market and calculate payouts
    await prisma.$transaction(async (tx) => {
      await tx.market.update({
        where: { id: marketId },
        data: { status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED', resolution: outcome },
      })

      if (outcome !== 'INVALID') {
        // Pay out winning positions
        const winningPositions = await tx.position.findMany({
          where: { marketId, outcome: outcome as 'YES' | 'NO' },
        })

        for (const position of winningPositions) {
          await tx.user.update({
            where: { id: position.userId },
            data: { balance: { increment: position.shares } },
          })
          const pnl = position.shares - position.avgEntryPrice * position.shares
          await tx.position.update({
            where: { id: position.id },
            data: { realizedPnl: { increment: pnl } },
          })
        }
      } else {
        // INVALID: refund based on cost paid
        const positions = await tx.position.findMany({ where: { marketId } })
        for (const position of positions) {
          const refund = position.avgEntryPrice * position.shares
          await tx.user.update({
            where: { id: position.userId },
            data: { balance: { increment: refund } },
          })
        }
      }
    })

    return apiSuccess({ success: true, outcome })
  } catch (err) {
    console.error('Resolve market error:', err)
    return apiError('Internal server error', 500)
  }
}
