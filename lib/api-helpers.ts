import { NextRequest, NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { verifyToken, JWTPayload } from './auth'
import { prisma } from './prisma'

export const AUTH_COOKIE_NAME = 'session_token'
export const LEGACY_AUTH_COOKIE_NAME = 'token'

type VerifiedTokenCandidate = {
  token: string
  index: number
  payload: JWTPayload
}

function getVerifiedTokensFromCookieHeader(cookieHeader: string | null, cookieName: string): VerifiedTokenCandidate[] {
  if (!cookieHeader) return []

  const tokenPairs = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => part.slice(`${cookieName}=`.length))
    .filter(Boolean)

  if (tokenPairs.length === 0) return []

  const verified = tokenPairs
    .map((token, index) => ({ token, index, payload: verifyToken(token) }))
    .filter((entry): entry is { token: string; index: number; payload: JWTPayload } => Boolean(entry.payload?.userId))

  if (verified.length === 0) return []

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

  return sortedByFreshness
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  const cookieHeader = req.headers.get('cookie')
  const cookieCandidates = getVerifiedTokensFromCookieHeader(cookieHeader, AUTH_COOKIE_NAME)
  if (cookieCandidates.length > 0) {
    return cookieCandidates[0].token
  }

  return req.cookies.get(AUTH_COOKIE_NAME)?.value || null
}

function getCandidateTokensFromRequest(req: NextRequest): string[] {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return [authHeader.slice(7)]
  }

  const cookieHeader = req.headers.get('cookie')
  const cookieCandidates = [
    ...getVerifiedTokensFromCookieHeader(cookieHeader, AUTH_COOKIE_NAME),
    ...getVerifiedTokensFromCookieHeader(cookieHeader, LEGACY_AUTH_COOKIE_NAME),
  ]

  if (cookieCandidates.length > 0) {
    const uniqueTokens = Array.from(new Set(cookieCandidates.map((candidate) => candidate.token)))
    return uniqueTokens
  }

  const fallback = req.cookies.get(AUTH_COOKIE_NAME)?.value || req.cookies.get(LEGACY_AUTH_COOKIE_NAME)?.value
  return fallback ? [fallback] : []
}

export async function getUserFromRequest(req: NextRequest): Promise<JWTPayload | null> {
  const tokens = getCandidateTokensFromRequest(req)
  if (tokens.length === 0) return null

  for (const token of tokens) {
    const payload = verifyToken(token)
    if (!payload) continue

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
      continue
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

  return null
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

function isDecimalLike(value: unknown): value is { toString: () => string } {
  if (Decimal.isDecimal(value)) return true

  // Fallback for serialized decimal-like objects that expose decimal internals.
  if (
    value
    && typeof value === 'object'
    && 's' in (value as Record<string, unknown>)
    && 'e' in (value as Record<string, unknown>)
    && 'd' in (value as Record<string, unknown>)
  ) {
    return true
  }

  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { toString?: unknown }).toString === 'function'
    && (value as { constructor?: { name?: string } }).constructor?.name === 'Decimal'
  )
}

function normalizeApiData(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (isDecimalLike(value)) {
    const numericValue = Number(value.toString())
    return Number.isFinite(numericValue) ? numericValue : 0
  }
  if (Array.isArray(value)) return (value as unknown[]).map(normalizeApiData)
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      out[k] = normalizeApiData(v)
    }
    return out
  }
  return value
}

export function apiSuccess(data: unknown, status: number = 200) {
  return NextResponse.json(normalizeApiData(data), { status })
}
