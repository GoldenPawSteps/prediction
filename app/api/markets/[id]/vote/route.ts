import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { MIN_RESOLUTION_VOTES, getQualifiedMajorityThreshold } from '@/lib/resolution'
import { z } from 'zod'

const voteSchema = z.object({
  outcome: z.enum(['YES', 'NO', 'INVALID']),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string; email: string; isAdmin: boolean }

  try {
    const { id: marketId } = await params
    const body = await req.json()
    const parsed = voteSchema.safeParse(body)

    if (!parsed.success) {
      return apiError('Invalid outcome')
    }

    const { outcome } = parsed.data

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: {
        id: true,
        status: true,
        endDate: true,
        resolution: true,
        resolutionTime: true,
      },
    })

    if (!market) return apiError('Market not found', 404)
    if (market.status === 'RESOLVED') return apiError('Market is already resolved')
    // DISPUTED markets allow re-voting so the community can resolve the dispute

    const now = new Date()
    if (now < market.endDate) {
      return apiError('Market has not ended yet. Voting opens after market end date.')
    }

    // Cast the vote (upsert to allow changing vote)
    const vote = await prisma.marketResolutionVote.upsert({
      where: { userId_marketId: { userId: authUser.userId, marketId } },
      update: { outcome },
      create: {
        userId: authUser.userId,
        marketId,
        outcome,
      },
    })

    // Check if we should auto-resolve based on vote count
    const votes = await prisma.marketResolutionVote.groupBy({
      by: ['outcome'],
      where: { marketId },
      _count: { id: true },
    })

    let shouldResolve = false
    let majorityOutcome: 'YES' | 'NO' | 'INVALID' | null = null
    const totalVotesCast = votes.reduce((sum, v) => sum + (v._count?.id ?? 0), 0)
    const qualifiedMajorityThreshold = getQualifiedMajorityThreshold(market.status)

    // Auto-resolve when quorum is met AND one outcome holds a qualified majority
    // (>= threshold of ALL votes cast, including INVALID)
    if (totalVotesCast >= MIN_RESOLUTION_VOTES) {
      for (const v of votes) {
        const share = (v._count?.id ?? 0) / totalVotesCast
        if (share >= qualifiedMajorityThreshold) {
          shouldResolve = true
          majorityOutcome = v.outcome as 'YES' | 'NO' | 'INVALID'
          break
        }
      }
    }

    // Auto-resolve if majority is clear
    if (shouldResolve && majorityOutcome) {
      const isReResolution = market.status === 'DISPUTED'
      const previousResolutionTime = market.resolutionTime

      // Resolve market
      await prisma.market.update({
        where: { id: marketId },
        data: {
          status: 'RESOLVED',
          resolution: majorityOutcome,
          resolutionTime: now,
        },
      })

      // Run resolution payouts (same logic as manual resolve)
      await runResolution(marketId, majorityOutcome, {
        isReResolution,
        previousResolutionTime,
      })
    }

    return apiSuccess({
      vote,
      autoResolved: shouldResolve,
      majorityOutcome: majorityOutcome || null,
    })
  } catch (err) {
    console.error('Vote error:', err)
    return apiError('Internal server error', 500)
  }
}

async function runResolution(
  marketId: string,
  outcome: 'YES' | 'NO' | 'INVALID',
  options?: { isReResolution?: boolean; previousResolutionTime?: Date | null }
) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: {
      id: true,
      creatorId: true,
      initialLiquidity: true,
    },
  })

  if (!market) return

  await prisma.$transaction(async (tx: any) => {
    await reversePreviousSettlementIfNeeded(
      tx,
      marketId,
      Boolean(options?.isReResolution),
      options?.previousResolutionTime ?? null
    )

    let totalPayout = 0

    if (outcome !== 'INVALID') {
      const winningOutcome = outcome as 'YES' | 'NO'
      const losingOutcome = outcome === 'YES' ? 'NO' : 'YES'

      const winningPositions = await tx.position.findMany({
        where: { marketId, outcome: winningOutcome, shares: { gt: 0 } },
      })
      for (const position of winningPositions) {
        totalPayout += position.shares
        await tx.user.update({
          where: { id: position.userId },
          data: { balance: { increment: position.shares } },
        })
        const pnl = position.shares - position.avgEntryPrice * position.shares
        await tx.position.update({
          where: { id: position.id },
          data: { realizedPnl: { increment: pnl } },
        })
        await tx.trade.create({
          data: {
            userId: position.userId,
            marketId,
            outcome: position.outcome,
            type: 'SELL',
            shares: position.shares,
            price: 1.0,
            totalCost: position.shares,
          },
        })
      }

      const losingPositions = await tx.position.findMany({
        where: { marketId, outcome: losingOutcome, shares: { gt: 0 } },
      })
      for (const position of losingPositions) {
        const pnl = -(position.avgEntryPrice * position.shares)
        await tx.position.update({
          where: { id: position.id },
          data: { realizedPnl: { increment: pnl } },
        })
        await tx.trade.create({
          data: {
            userId: position.userId,
            marketId,
            outcome: position.outcome,
            type: 'SELL',
            shares: position.shares,
            price: 0.0,
            totalCost: 0.0,
          },
        })
      }
    } else {
      const positions = await tx.position.findMany({ where: { marketId, shares: { gt: 0 } } })
      for (const position of positions) {
        const refund = position.avgEntryPrice * position.shares
        totalPayout += refund
        await tx.user.update({
          where: { id: position.userId },
          data: { balance: { increment: refund } },
        })
        await tx.trade.create({
          data: {
            userId: position.userId,
            marketId,
            outcome: position.outcome,
            type: 'SELL',
            shares: position.shares,
            price: position.avgEntryPrice,
            totalCost: refund,
          },
        })
      }
    }

    await tx.position.updateMany({
      where: { marketId },
      data: { shares: 0 },
    })

    const tradeAggregate = await tx.trade.aggregate({
      where: { marketId },
      _sum: { totalCost: true },
    })
    const netTradeCost = tradeAggregate._sum.totalCost ?? 0
    const remainingLiquidity = market.initialLiquidity + netTradeCost - totalPayout
    const refundedToCreator = Math.max(0, remainingLiquidity)

    if (!options?.isReResolution && refundedToCreator > 0) {
      await tx.user.update({
        where: { id: market.creatorId },
        data: { balance: { increment: refundedToCreator } },
      })
    }
  })
}

async function reversePreviousSettlementIfNeeded(
  tx: any,
  marketId: string,
  isReResolution: boolean,
  previousResolutionTime: Date | null
) {
  if (!isReResolution || !previousResolutionTime) return 0

  const settlementTrades = await tx.trade.findMany({
    where: {
      marketId,
      type: 'SELL',
      createdAt: { gte: previousResolutionTime },
      shares: { gt: 0 },
    },
    orderBy: { createdAt: 'asc' },
  })

  for (const trade of settlementTrades) {
    if (trade.totalCost > 0) {
      await tx.user.update({
        where: { id: trade.userId },
        data: { balance: { decrement: trade.totalCost } },
      })
    }

    const position = await tx.position.findUnique({
      where: {
        userId_marketId_outcome: {
          userId: trade.userId,
          marketId,
          outcome: trade.outcome,
        },
      },
      select: { id: true, avgEntryPrice: true },
    })

    if (position) {
      const settlementPnl = (trade.price - position.avgEntryPrice) * trade.shares
      await tx.position.update({
        where: { id: position.id },
        data: {
          shares: { increment: trade.shares },
          realizedPnl: { decrement: settlementPnl },
        },
      })
    }

    await tx.trade.create({
      data: {
        userId: trade.userId,
        marketId,
        outcome: trade.outcome,
        type: 'BUY',
        shares: trade.shares,
        price: trade.price,
        totalCost: trade.totalCost,
      },
    })
  }

  return settlementTrades.length
}
