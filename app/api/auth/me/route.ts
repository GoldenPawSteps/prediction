import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/api-helpers'
import { apiError, apiSuccess } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const userOrResponse = requireAuth(req)
  if ('status' in userOrResponse && !('userId' in userOrResponse)) {
    return userOrResponse
  }
  const authUser = userOrResponse as { userId: string; email: string; isAdmin: boolean }

  try {
    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        bio: true,
        balance: true,
        isAdmin: true,
        createdAt: true,
      },
    })

    if (!user) return apiError('User not found', 404)
    return apiSuccess(user)
  } catch (err) {
    console.error('Get me error:', err)
    return apiError('Internal server error', 500)
  }
}
