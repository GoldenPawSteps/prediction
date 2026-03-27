import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME, getUserFromRequest } from '@/lib/api-helpers'

function shouldUseSecureCookies(req: NextRequest): boolean {
  if (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1') {
    return false
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')
  if (forwardedProto) return forwardedProto === 'https'
  return req.nextUrl.protocol === 'https:'
}

function clearAuthCookies(response: NextResponse, req: NextRequest) {
  const secureCookie = shouldUseSecureCookies(req)

  for (const name of [AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME]) {
    response.cookies.delete(name)
    for (const path of ['/', '/api']) {
      response.cookies.set(name, '', {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'lax',
        path,
        maxAge: 0,
        expires: new Date(0),
      })
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getUserFromRequest(req)
    if (authUser) {
      await prisma.user.update({
        where: { id: authUser.userId },
        data: { sessionVersion: { increment: 1 } },
      })
    }
  } catch (error) {
    // Still clear cookies even if DB/session invalidation fails.
    console.error('Logout invalidation error:', error)
  }

  const response = NextResponse.json({ success: true })
  clearAuthCookies(response, req)

  return response
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getUserFromRequest(req)
    if (authUser) {
      await prisma.user.update({
        where: { id: authUser.userId },
        data: { sessionVersion: { increment: 1 } },
      })
    }
  } catch (error) {
    // Best-effort DB invalidation; cookie clearing below remains authoritative.
    console.error('Logout redirect invalidation error:', error)
  }

  const requestedNext = req.nextUrl.searchParams.get('next')
  const nextPath = requestedNext && requestedNext.startsWith('/') ? requestedNext : '/auth/login'
  const redirectUrl = new URL(nextPath, req.url)
  const response = NextResponse.redirect(redirectUrl)
  clearAuthCookies(response, req)

  return response
}
