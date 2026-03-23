import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from './auth'

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

  // Defensive handling for duplicate token cookies.
  // If duplicates resolve to different users, the session is ambiguous and must be rejected.
  const verified = tokenPairs
    .map((token) => ({ token, payload: verifyToken(token) }))
    .filter((entry): entry is { token: string; payload: JWTPayload } => Boolean(entry.payload?.userId))

  if (verified.length === 0) return null

  const userIds = new Set(verified.map((entry) => entry.payload.userId))
  if (userIds.size > 1) {
    console.warn('Ambiguous auth cookies detected: multiple token cookies map to different users')
    return null
  }

  // Same user across duplicates: use the last one sent.
  return verified[verified.length - 1].token
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  // Only trust the canonical auth cookie name. Legacy cookies are ignored.
  const cookieHeader = req.headers.get('cookie')
  const cookieToken = getTokenFromCookieHeader(cookieHeader, AUTH_COOKIE_NAME)
  if (cookieToken === null && cookieHeader?.includes(`${AUTH_COOKIE_NAME}=`)) {
    // Ambiguous or invalid cookies detected - fail auth entirely.
    return null
  }

  return cookieToken || req.cookies.get(AUTH_COOKIE_NAME)?.value || null
}

export async function getUserFromRequest(req: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(req)
  if (!token) return null
  return verifyToken(token)
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
