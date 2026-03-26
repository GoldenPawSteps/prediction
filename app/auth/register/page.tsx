'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useT } from '@/context/I18nContext'

export default function RegisterPage() {
  const t = useT('auth')
  const { user, loading: authLoading, register, refreshUser } = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({ email: '', username: '', password: '' })
  const [loading, setLoading] = useState(false)

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
    const success = await register(form.email, form.username, form.password)
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('createAccount')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{t('registerSubtitle')}</p>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="email"
            label={t('email')}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
            required
          />
          <Input
            id="username"
            label={t('username')}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="cryptotrader99"
            hint={t('usernameHint')}
            required
          />
          <Input
            id="password"
            label={t('password')}
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={t('passwordPlaceholder')}
            hint={t('passwordHint')}
            required
            minLength={8}
          />
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            {t('createAccountBtn')}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-500">
          {t('startMoney')}
        </p>

        <div className="mt-4 text-center text-sm text-gray-600 dark:text-gray-500">
          {t('haveAccount')}{' '}
          <Link href="/auth/login" className="text-indigo-400 hover:underline">
            {t('signInLink')}
          </Link>
        </div>
      </div>
    </div>
  )
}
