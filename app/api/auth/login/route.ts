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

    const response = apiSuccess({ user: userWithoutPassword, token })
    // Clear any stale token first to prevent multiple tokens
    response.cookies.delete('token')
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: shouldUseSecureCookies(req),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    })
    return response
  } catch (err) {
    console.error('Login error:', err)
    return apiError('Internal server error', 500)
  }
}
