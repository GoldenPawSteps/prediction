import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, signToken } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

function shouldUseSecureCookies(req: NextRequest): boolean {
  if (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1') {
    return false
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')
  if (forwardedProto) return forwardedProto === 'https'
  return req.nextUrl.protocol === 'https:'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
      return apiError('Invalid email or password')
    }

    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, passwordHash: true, balance: true, isAdmin: true, avatar: true },
    })

    if (!user || !user.passwordHash) {
      return apiError('Invalid email or password', 401)
    }

    const valid = await comparePassword(password, user.passwordHash)
    if (!valid) {
      return apiError('Invalid email or password', 401)
    }

    const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin })
    const { passwordHash, ...userWithoutPassword } = user
    void passwordHash
    const secureCookie = shouldUseSecureCookies(req)

    const response = apiSuccess({ user: userWithoutPassword, token })
    // Explicitly delete all token cookie variants to prevent duplicate tokens in cookie jar.
    // This is critical to prevent privilege escalation where an old admin token could be picked up.
    response.cookies.delete('token')
    // Also explicitly set both variants with maxAge 0 to ensure browser clears them across all domains/paths.
    response.cookies.set('token', '', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    response.cookies.set('token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    // Now set the new token with appropriate secure flag.
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    return response
  } catch (err) {
    console.error('Login error:', err)
    return apiError('Internal server error', 500)
  }
}
