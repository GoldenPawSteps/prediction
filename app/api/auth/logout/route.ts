import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true })
  // Explicitly delete token cookie, then also set both variants with maxAge: 0 for redundant clearing.
  response.cookies.delete('token')
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
  return response
}
