import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from './auth'

function getTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  const tokenPairs = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('token='))
    .map((part) => part.slice('token='.length))
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

  // Prefer raw cookie header parsing to handle duplicate token cookies reliably.
  const cookieToken = getTokenFromCookieHeader(req.headers.get('cookie')) ?? req.cookies.get('token')?.value
  return cookieToken || null
}

export function getUserFromRequest(req: NextRequest): JWTPayload | null {
  const token = getTokenFromRequest(req)
  if (!token) return null
  return verifyToken(token)
}

export function requireAuth(req: NextRequest): JWTPayload | NextResponse {
  const user = getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return user
}

export function requireAdmin(req: NextRequest): JWTPayload | NextResponse {
  const user = getUserFromRequest(req)
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
