'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useT } from '@/context/I18nContext'

export default function LoginPage() {
  const t = useT('auth')
  const { user, loading: authLoading, login, refreshUser } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleInvalidField = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      target.focus({ preventScroll: true })
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/')
    }
  }, [authLoading, user, router])

  if (!authLoading && user) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const success = await login(email, password)
    if (success) {
      await refreshUser()
      router.push('/')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="text-center mb-8">
        <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
          <span className="text-white font-bold text-lg">P</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('welcomeBack')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{t('signInSubtitle')}</p>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <form
          onSubmit={handleSubmit}
          onInvalidCapture={(e) => handleInvalidField(e.target)}
          className="space-y-4"
        >
          <Input
            id="email"
            label={t('email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <Input
            id="password"
            label={t('password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            {t('signIn')}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-600 dark:text-gray-500">
          {t('noAccount')}{' '}
          <Link href="/auth/register" className="text-indigo-400 hover:underline">
            {t('signUpLink')}
          </Link>
        </div>

        {/* Demo credentials */}
        <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs text-gray-600 dark:text-gray-500">
          <p className="font-medium text-gray-700 dark:text-gray-400 mb-1">{t('demoAccount')}</p>
          <p>Email: demo@predictify.com</p>
          <p>Password: demo1234</p>
        </div>
      </div>
    </div>
  )
}
