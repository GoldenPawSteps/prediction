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

  // If single token, return it
  if (tokenPairs.length === 1) return tokenPairs[0]

  // If multiple tokens, verify each and return the most recent valid one
  let bestToken: { token: string; iat: number } | null = null
  for (const token of tokenPairs) {
    const decoded = verifyToken(token) as any
    if (decoded && decoded.iat) {
      if (!bestToken || decoded.iat > bestToken.iat) {
        bestToken = { token, iat: decoded.iat }
      }
    }
  }

  return bestToken?.token || tokenPairs[tokenPairs.length - 1] || null
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
