import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { z } from 'zod'

const commentSchema = z.object({ content: z.string().min(1).max(500) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string }

  try {
    const { id: marketId } = await params
    const body = await req.json()
    const parsed = commentSchema.safeParse(body)
    if (!parsed.success) return apiError(parsed.error.issues[0].message)

    const comment = await prisma.comment.create({
      data: { userId: authUser.userId, marketId, content: parsed.data.content },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    })

    return apiSuccess(comment, 201)
  } catch (err) {
    console.error('Comment error:', err)
    return apiError('Internal server error', 500)
  }
}
