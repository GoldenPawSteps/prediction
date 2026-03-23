import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from './auth'
import { prisma } from './prisma'

export const AUTH_COOKIE_NAME = 'session_token'
export const LEGACY_AUTH_COOKIE_NAME = 'token'

function getTokenFromCookieHeader(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) return null

  const tokenPairs = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => part.slice(`${cookieName}=`.length))
    .filter(Boolean)

  if (tokenPairs.length === 0) return null

  if (tokenPairs.length === 1) return tokenPairs[0]

  const verified = tokenPairs
    .map((token, index) => ({ token, index, payload: verifyToken(token) }))
    .filter((entry): entry is { token: string; index: number; payload: JWTPayload } => Boolean(entry.payload?.userId))

  if (verified.length === 0) return null

  const sortedByFreshness = [...verified].sort((a, b) => {
    const aiat = a.payload.iat ?? 0
    const biat = b.payload.iat ?? 0
    if (aiat !== biat) return biat - aiat
    return b.index - a.index
  })

  const userIds = new Set(verified.map((entry) => entry.payload.userId))
  if (userIds.size > 1) {
    console.warn('Ambiguous auth cookies detected: selecting most recent token by iat')
  }

  return sortedByFreshness[0].token
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  const cookieHeader = req.headers.get('cookie')
  const cookieToken = getTokenFromCookieHeader(cookieHeader, AUTH_COOKIE_NAME)
  if (cookieToken) {
    return cookieToken
  }

  return req.cookies.get(AUTH_COOKIE_NAME)?.value || null
}

export async function getUserFromRequest(req: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(req)
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      sessionVersion: true,
    },
  })

  if (!user || user.sessionVersion !== payload.sessionVersion) {
    return null
  }

  return {
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    sessionVersion: user.sessionVersion,
    iat: payload.iat,
    exp: payload.exp,
  }
}

export async function requireAuth(req: NextRequest): Promise<JWTPayload | NextResponse> {
  const user = await getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return user
}

export async function requireAdmin(req: NextRequest): Promise<JWTPayload | NextResponse> {
  const user = await getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return user
}

export function apiError(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status })
}

export function apiSuccess(data: unknown, status: number = 200) {
  return NextResponse.json(data, { status })
}
