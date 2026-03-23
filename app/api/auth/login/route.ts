import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, signToken } from '@/lib/auth'
import { AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAME, apiError, apiSuccess } from '@/lib/api-helpers'
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

function clearCookiePathVariants(response: ReturnType<typeof apiSuccess>, name: string) {
  for (const path of ['/', '/api']) {
    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      path,
      maxAge: 0,
      expires: new Date(0),
    })
  }
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
      select: { id: true, email: true, username: true, passwordHash: true, balance: true, isAdmin: true, avatar: true, sessionVersion: true },
    })

    if (!user || !user.passwordHash) {
      return apiError('Invalid email or password', 401)
    }

    const valid = await comparePassword(password, user.passwordHash)
    if (!valid) {
      return apiError('Invalid email or password', 401)
    }

    const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin, sessionVersion: user.sessionVersion })
    const { passwordHash, ...userWithoutPassword } = user
    void passwordHash
    const secureCookie = shouldUseSecureCookies(req)

    const response = apiSuccess({ user: userWithoutPassword, token })
    clearCookiePathVariants(response, AUTH_COOKIE_NAME)
    clearCookiePathVariants(response, LEGACY_AUTH_COOKIE_NAME)

    // Set the auth cookie once. Setting with a longer maxAge naturally replaces any
    // existing session_token cookie in the browser.
    response.cookies.set(AUTH_COOKIE_NAME, token, {
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
