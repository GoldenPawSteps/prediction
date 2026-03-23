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

  // Parse raw cookie header to detect and reject ambiguous cookies.
  // If ambiguous cookies detected, return null to fail auth (don't fallback to req.cookies).
  const cookieToken = getTokenFromCookieHeader(req.headers.get('cookie'))
  if (cookieToken === null && req.headers.get('cookie')?.includes('token=')) {
    // Ambiguous or invalid cookies detected - fail auth entirely.
    return null
  }
  
  // Only use req.cookies.get as fallback if no token= in raw cookie header at all.
  return cookieToken || req.cookies.get('token')?.value || null
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
