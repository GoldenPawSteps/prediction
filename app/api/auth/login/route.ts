import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, signToken } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-helpers'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

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
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    })
    return response
  } catch (err) {
    console.error('Login error:', err)
    return apiError('Internal server error', 500)
  }
}
