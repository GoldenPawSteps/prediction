import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { z } from 'zod'

const disputeSchema = z.object({
  reason: z.string().min(20).max(1000),
  proposedOutcome: z.enum(['YES', 'NO', 'INVALID']),
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
    const parsed = disputeSchema.safeParse(body)

    if (!parsed.success) {
      return apiError('Invalid dispute data')
    }

    const { reason, proposedOutcome } = parsed.data

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: {
        id: true,
        status: true,
        resolution: true,
        resolutionTime: true,
        disputeWindowHours: true,
      },
    })

    if (!market) return apiError('Market not found', 404)
    if (market.status !== 'RESOLVED') return apiError('Market must be resolved to dispute')

    const now = new Date()
    const disputeWindowMs = (market.disputeWindowHours || 24) * 60 * 60 * 1000
    const timeSinceResolution = now.getTime() - (market.resolutionTime?.getTime() ?? 0)

    if (timeSinceResolution > disputeWindowMs) {
      return apiError(`Dispute window has closed (${market.disputeWindowHours || 24} hours after resolution)`)
    }

    // Create dispute
    const dispute = await prisma.marketDispute.create({
      data: {
        userId: authUser.userId,
        marketId,
        reason,
        proposedOutcome,
        status: 'OPEN',
      },
    })

    // Update market status to DISPUTED
    await prisma.market.update({
      where: { id: marketId },
      data: { status: 'DISPUTED' },
    })

    return apiSuccess({ dispute, message: 'Dispute filed successfully. Market status is now DISPUTED.' }, 201)
  } catch (err) {
    console.error('Dispute error:', err)
    return apiError('Internal server error', 500)
  }
}
