import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, apiError, apiSuccess } from '@/lib/api-helpers'
import { z } from 'zod'

const commentSchema = z.object({ content: z.string().min(1).max(500) })

interface CommentPayload {
  id: string
  content: string
  createdAt: string
  user: {
    id: string
    username: string
    avatar: string | null
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: marketId } = await params

    const comments = await prisma.comment.findMany({
      where: { marketId },
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return apiSuccess(
      comments.map((comment) => ({
        ...comment,
        createdAt: comment.createdAt.toISOString(),
      })) as CommentPayload[]
    )
  } catch (err) {
    console.error('Failed to fetch comments:', err)
    return apiError('Failed to fetch comments', 500)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = await requireAuth(req)
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
