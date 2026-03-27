import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { getQualifiedMajorityThreshold, getResolutionQuorum, isImmediateResolutionRound } from '@/lib/resolution'
import { settleMarketResolution } from '@/lib/market-settlement'
import { z } from 'zod'

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const voteSchema = z.object({
  outcome: z.enum(['YES', 'NO', 'INVALID']),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = await requireAuth(req)
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
        _count: {
          select: {
            disputes: true,
          },
        },
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

    // Append an immutable history entry so the activity timeline shows every
    // vote cast, including changed votes.
    await prisma.marketVoteHistory.create({
      data: {
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
    const resolutionQuorum = getResolutionQuorum(market._count.disputes)
    const qualifiedMajorityThreshold = getQualifiedMajorityThreshold(market._count.disputes)

    // Initial resolution resolves on the first vote.
    if (isImmediateResolutionRound(market._count.disputes) && totalVotesCast > 0) {
      shouldResolve = true
      majorityOutcome = outcome
    }

    // Dispute rounds require quorum plus a strict threshold over ALL votes cast,
    // including INVALID votes.
    if (!shouldResolve && totalVotesCast >= resolutionQuorum) {
      for (const v of votes) {
        const share = (v._count?.id ?? 0) / totalVotesCast
        if (share > qualifiedMajorityThreshold) {
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

  await prisma.$transaction(async (tx: TxClient) => {
    await settleMarketResolution(tx, {
      marketId,
      outcome,
      creatorId: market.creatorId,
      initialLiquidity: market.initialLiquidity,
      isReResolution: Boolean(options?.isReResolution),
      previousResolutionTime: options?.previousResolutionTime ?? null,
    })
  })
}
