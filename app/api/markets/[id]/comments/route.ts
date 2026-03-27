import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiSuccess } from '@/lib/api-helpers'

interface Comment {
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
    const { id } = await params

    const comments = await prisma.comment.findMany({
      where: { marketId: id },
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

    // Convert Date objects to ISO strings
    const formattedComments = comments.map((comment: { id: string; content: string; createdAt: Date; user: { id: string; username: string; avatar: string | null } }) => ({
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    }))

    return apiSuccess(formattedComments as Comment[])
  } catch (err) {
    console.error('Failed to fetch comments:', err)
    return apiError('Failed to fetch comments', 500)
  }
}
