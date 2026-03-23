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

  // Return the last token (most recently sent by browser).
  // Multiple tokens shouldn't exist, but if they do, always use the last one.
  // Do NOT pick by iat timestamp — that creates a privilege escalation vulnerability
  // where a more recent admin token would be selected over a regular user token.
  return tokenPairs[tokenPairs.length - 1]
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
