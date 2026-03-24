'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useT } from '@/context/I18nContext'
import toast from 'react-hot-toast'

const CATEGORIES = ['Politics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Finance', 'Other']
const CATEGORY_KEYS = {
  Politics: 'politics',
  Crypto: 'crypto',
  Sports: 'sports',
  Tech: 'tech',
  Entertainment: 'entertainment',
  Science: 'science',
  Finance: 'finance',
  Other: 'other',
} as const

// Convert local date to datetime-local format string
function getLocalDateTimeString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export default function CreateMarketPage() {
  const t = useT('createMarket')
  const tCategories = useT('categories')
  const router = useRouter()
  const { user, optimisticUpdateBalance } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Crypto',
    endDate: '',
    resolutionSource: '',
    initialLiquidity: 100,
    disputeWindowHours: 24,
    tags: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const errs: Record<string, string> = {}
    if (form.title.length < 10) errs.title = t('validationTitleMin')
    if (form.description.length < 20) errs.description = t('validationDescriptionMin')
    if (!form.endDate) errs.endDate = t('validationEndDateRequired')
    else if (new Date(form.endDate) <= new Date()) errs.endDate = t('validationEndDateFuture')
    if (!form.resolutionSource) errs.resolutionSource = t('validationResolutionRequired')
    else if (!form.resolutionSource.startsWith('http')) errs.resolutionSource = t('validationResolutionUrl')
    if (form.initialLiquidity < 10 || form.initialLiquidity > 10000) errs.initialLiquidity = t('validationLiquidityRange')
    if (form.disputeWindowHours < 1 || form.disputeWindowHours > 720) errs.disputeWindowHours = t('validationDisputeRange')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) { router.push('/auth/login'); return }
    if (!validate()) return

    setLoading(true)
    try {
      const res = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...form,
          endDate: new Date(form.endDate).toISOString(),
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          initialLiquidity: Number(form.initialLiquidity),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        optimisticUpdateBalance(Number(form.initialLiquidity))
        toast.success(t('toastCreated'))
        router.push(`/markets/${data.market.id}`)
      } else {
        toast.error(data.error || t('toastCreateFailed'))
      }
    } catch {
      toast.error(t('toastNetworkError'))
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-600 dark:text-gray-400 mb-4">{t('notLoggedIn')}</p>
        <a href="/auth/login" className="text-indigo-400 hover:underline">{t('notLoggedInLink')}</a>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      {/* Risk Warning */}
      <div className="bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700/30 rounded-xl p-4 mb-6 text-sm text-yellow-900 dark:text-yellow-200">
        ⚠️ <strong>{t('riskWarning')}</strong>{' '}
        {t('riskLocked', { amount: form.initialLiquidity })}
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('questionLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t('questionPlaceholder')}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.title && <p className="text-red-400 text-xs mt-1">{errors.title}</p>}
          <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">{t('questionLength', { count: form.title.length, total: 200 })}</p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('descriptionLabel')} <span className="text-red-400">*</span>
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('descriptionPlaceholder')}
            rows={4}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description}</p>}
        </div>

        {/* Category & End Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('categoryLabel')}</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CATEGORIES.map((cat) => <option key={cat} value={cat}>{tCategories(CATEGORY_KEYS[cat])}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('endDateLabel')} <span className="text-red-400">*</span>
            </label>
            <input
              type="datetime-local"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              min={getLocalDateTimeString(new Date())}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {errors.endDate && <p className="text-red-400 text-xs mt-1">{errors.endDate}</p>}
          </div>
        </div>

        {/* Resolution Source */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('resolutionLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            type="url"
            value={form.resolutionSource}
            onChange={(e) => setForm({ ...form, resolutionSource: e.target.value })}
            placeholder={t('resolutionPlaceholder')}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.resolutionSource && <p className="text-red-400 text-xs mt-1">{errors.resolutionSource}</p>}
          <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">{t('resolutionHint')}</p>
        </div>

        {/* Initial Liquidity */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('liquidityLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            min="10"
            max="10000"
            value={form.initialLiquidity}
            onChange={(e) => setForm({ ...form, initialLiquidity: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.initialLiquidity && <p className="text-red-400 text-xs mt-1">{errors.initialLiquidity}</p>}
          <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">
            {t('liquidityHint', { balance: user.balance.toFixed(2) })}
          </p>
        </div>

        {/* Dispute Window */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('disputeLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            min="1"
            max="720"
            value={form.disputeWindowHours}
            onChange={(e) => setForm({ ...form, disputeWindowHours: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.disputeWindowHours && <p className="text-red-400 text-xs mt-1">{errors.disputeWindowHours}</p>}
          <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">{t('disputeHint')}</p>
        </div>

        {/* Tags */}
        <Input
          label={t('tagsLabel')}
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder={t('tagsPlaceholder')}
          hint={t('tagsHint')}
        />

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          {t('submit', { amount: form.initialLiquidity })}
        </Button>
      </form>
    </div>
  )
}
