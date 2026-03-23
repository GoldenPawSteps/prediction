import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME, getUserFromRequest } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  const authUser = await getUserFromRequest(req)
  if (authUser) {
    await prisma.user.update({
      where: { id: authUser.userId },
      data: { sessionVersion: { increment: 1 } },
    })
  }

  const response = NextResponse.json({ success: true })
  for (const name of [AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME]) {
    for (const path of ['/', '/api']) {
      response.cookies.set(name, '', {
        httpOnly: true,
        sameSite: 'lax',
        path,
        maxAge: 0,
        expires: new Date(0),
      })
    }
  }

  return response
}
