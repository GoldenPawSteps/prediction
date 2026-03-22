import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, signToken } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { z } from 'zod'

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
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
    const parsed = registerSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message)
    }

    const { email, username, password } = parsed.data

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    })

    if (existing) {
      return apiError('Email or username already taken', 409)
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: { email, username, passwordHash },
      select: { id: true, email: true, username: true, balance: true, isAdmin: true, avatar: true },
    })

    const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin })

    const response = apiSuccess({ user, token }, 201)
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
    console.error('Register error:', err)
    return apiError('Internal server error', 500)
  }
}
