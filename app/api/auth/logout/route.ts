import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME, getUserFromRequest, getValidAuthUsersFromRequest } from '@/lib/api-helpers'

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
  const host = req.nextUrl.hostname
  const hostParts = host.split('.')
  const parentDomain = hostParts.length >= 3 ? `.${hostParts.slice(-2).join('.')}` : null

  for (const name of [AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME]) {
    response.cookies.delete(name)

    const clearTargets: Array<{ path: string; domain?: string }> = [
      { path: '/' },
      { path: '/api' },
      { path: '/', domain: host },
      { path: '/api', domain: host },
    ]

    if (parentDomain) {
      clearTargets.push({ path: '/', domain: parentDomain })
      clearTargets.push({ path: '/api', domain: parentDomain })
    }

    for (const target of clearTargets) {
      response.cookies.set(name, '', {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'lax',
        path: target.path,
        ...(target.domain ? { domain: target.domain } : {}),
        maxAge: 0,
        expires: new Date(0),
      })
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUsers = await getValidAuthUsersFromRequest(req)
    const userIds = Array.from(new Set(authUsers.map((user) => user.userId)))

    if (userIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
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
    const authUsers = await getValidAuthUsersFromRequest(req)
    const userIds = Array.from(new Set(authUsers.map((user) => user.userId)))

    if (userIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
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
