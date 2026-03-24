import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'

interface ResolutionData {
  status: string
  resolution: string | null
  resolutionTime: string | null
  disputeWindowHours: number
  resolutionVotes: Array<{
    userId: string
    outcome: string
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  disputes: Array<{
    id: string
    proposedOutcome: string
    status: string
    reason: string
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  endDate: string
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const market = await prisma.market.findUnique({
      where: { id },
      select: {
        status: true,
        resolution: true,
        resolutionTime: true,
        disputeWindowHours: true,
        endDate: true,
      },
    })

    if (!market) return apiError('Market not found', 404)

    // Fetch resolution votes separately
    const resolutionVotes = await prisma.marketResolutionVote.findMany({
      where: { marketId: id },
      select: {
        userId: true,
        outcome: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Fetch disputes separately
    const disputes = await prisma.marketDispute.findMany({
      where: { marketId: id },
      select: {
        id: true,
        proposedOutcome: true,
        status: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    // Convert Date objects to ISO strings
    const formattedData: ResolutionData = {
      status: market.status,
      resolution: market.resolution,
      resolutionTime: market.resolutionTime?.toISOString() ?? null,
      disputeWindowHours: market.disputeWindowHours,
      endDate: market.endDate.toISOString(),
      resolutionVotes: resolutionVotes.map(vote => ({
        userId: vote.userId,
        outcome: vote.outcome,
        createdAt: vote.createdAt.toISOString(),
        user: vote.user,
      })),
      disputes: disputes.map(dispute => ({
        ...dispute,
        createdAt: dispute.createdAt.toISOString(),
      })),
    }

    return apiSuccess(formattedData)
  } catch (err) {
    console.error('Failed to fetch resolution data:', err)
    return apiError('Failed to fetch resolution data', 500)
  }
}
