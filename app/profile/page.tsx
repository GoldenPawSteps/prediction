'use client'

import { useAuth } from '@/context/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { useT } from '@/context/I18nContext'
import { useState } from 'react'

export default function ProfilePage() {
  const t = useT('profile')
  const { user, updateProfile } = useAuth()
  const [editMode, setEditMode] = useState(false)
  const [username, setUsername] = useState(user?.username || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [loading, setLoading] = useState(false)

  if (!user) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 mb-4">{t('loginPrompt')}</p>
        <a href="/auth/login" className="text-indigo-400 hover:underline">{t('loginLink')}</a>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
          {user.username[0].toUpperCase()}
        </div>
        {editMode ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setLoading(true)
              const ok = await updateProfile({ username, bio })
              setLoading(false)
              if (ok) setEditMode(false)
            }}
          >
            <input
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('username')}
              disabled={loading}
              required
              minLength={3}
              maxLength={32}
            />
            <textarea
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t('bio')}
              rows={3}
              maxLength={160}
              disabled={loading}
            />
            <div className="flex gap-2 justify-center mt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-300 dark:hover:bg-gray-600"
                onClick={() => setEditMode(false)}
                disabled={loading}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">@{user.username}</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">{user.email}</p>
            {user.bio && <p className="text-gray-700 dark:text-gray-300 text-sm mt-2">{user.bio}</p>}
            <p className="text-gray-500 text-xs mt-2">{t('memberSince', { date: formatDate(user.createdAt) })}</p>
            {user.isAdmin && (
              <span className="inline-block mt-2 px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded font-medium">
                {t('adminBadge')}
              </span>
            )}
            <button
              className="mt-4 px-4 py-2 rounded bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
              onClick={() => {
                setEditMode(true)
                setUsername(user.username)
                setBio(user.bio || '')
              }}
            >
              {t('editProfile')}
            </button>
          </>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{t('accountSection')}</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">{t('balance')}</span>
            <span className="text-green-400 font-semibold">{formatCurrency(user.balance)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">{t('accountType')}</span>
            <span className="text-gray-700 dark:text-gray-300">{user.isAdmin ? t('adminBadge') : t('trader')}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/portfolio" className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-indigo-500/50 rounded-xl p-4 text-center transition-colors">
          <div className="text-2xl mb-2">📊</div>
          <p className="text-gray-900 dark:text-white font-medium text-sm">{t('portfolio')}</p>
        </Link>
        <Link href="/markets/create" className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-indigo-500/50 rounded-xl p-4 text-center transition-colors">
          <div className="text-2xl mb-2">➕</div>
          <p className="text-gray-900 dark:text-white font-medium text-sm">{t('createMarket')}</p>
        </Link>
      </div>
    </div>
  )
}
