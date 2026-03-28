'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useT } from '@/context/I18nContext'
import toast from 'react-hot-toast'

const CATEGORIES = ['Politics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Finance', 'Other'] as const
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

const CREATE_MARKET_ERROR_TOAST_ID = 'create-market-error'

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
  const { user, loading: authLoading, optimisticUpdateBalance } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    marketType: 'BINARY' as 'BINARY' | 'MULTI',
    title: '',
    description: '',
    category: 'Crypto',
    endDate: '',
    resolutionSource: '',
    initialLiquidity: 100,
    priorProbability: 50,
    disputeWindowHours: 24,
    tags: '',
    outcomes: [
      { name: '', initialLiquidity: 100, priorProbability: 50 },
      { name: '', initialLiquidity: 100, priorProbability: 50 },
    ],
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const formRef = useRef<HTMLFormElement>(null)
  const errorToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearErrorToastTimeout = () => {
    if (!errorToastTimeoutRef.current) return
    clearTimeout(errorToastTimeoutRef.current)
    errorToastTimeoutRef.current = null
  }

  const showCreateErrorToast = (message: string) => {
    clearErrorToastTimeout()

    toast.error(message, {
      id: CREATE_MARKET_ERROR_TOAST_ID,
      duration: Infinity,
    })

    errorToastTimeoutRef.current = setTimeout(() => {
      toast.dismiss(CREATE_MARKET_ERROR_TOAST_ID)
      errorToastTimeoutRef.current = null
    }, 4000)
  }

  useEffect(() => () => clearErrorToastTimeout(), [])

  const revealFirstInvalidField = (errs: Record<string, string>) => {
    const keys = Object.keys(errs)
    if (keys.length === 0) return

    const key = keys[0]
    const formEl = formRef.current

    const focusField = (selector: string) => {
      const field = formEl?.querySelector<HTMLElement>(selector)
      if (!field) return false
      field.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
        field.focus({ preventScroll: true })
      }
      return true
    }

    let handled = false
    if (key === 'title') handled = focusField('[name="title"]')
    else if (key === 'description') handled = focusField('[name="description"]')
    else if (key === 'endDate') handled = focusField('[name="endDate"]')
    else if (key === 'resolutionSource') handled = focusField('[name="resolutionSource"]')
    else if (key === 'initialLiquidity') handled = focusField('[name="initialLiquidity"]')
    else if (key === 'priorProbability') handled = focusField('[name="priorProbability"]')
    else if (key === 'disputeWindowHours') handled = focusField('[name="disputeWindowHours"]')
    else if (key === 'outcomes') handled = focusField('[data-field="outcomes-section"]')
    else if (key.startsWith('outcomeName_') || key.startsWith('outcomeLiquidity_') || key.startsWith('outcomePrior_')) {
      const index = key.split('_')[1]
      const type = key.startsWith('outcomeName_') ? 'name' : key.startsWith('outcomeLiquidity_') ? 'liquidity' : 'prior'
      handled = focusField(`[name="outcome-${index}-${type}"]`)
    }

    if (!handled) {
      formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const validate = () => {
    const errs: Record<string, string> = {}
    if (form.title.length < 10) errs.title = t('validationTitleMin')
    if (form.description.length < 20) errs.description = t('validationDescriptionMin')
    if (!form.endDate) errs.endDate = t('validationEndDateRequired')
    else if (new Date(form.endDate) <= new Date()) errs.endDate = t('validationEndDateFuture')
    if (!form.resolutionSource) errs.resolutionSource = t('validationResolutionRequired')
    else if (!form.resolutionSource.startsWith('http')) errs.resolutionSource = t('validationResolutionUrl')
    if (form.marketType === 'BINARY') {
      if (form.initialLiquidity < 10 || form.initialLiquidity > 10000) errs.initialLiquidity = t('validationLiquidityRange')
      if (form.priorProbability < 1 || form.priorProbability > 99) errs.priorProbability = t('validationPriorRange')
    } else {
      if (form.outcomes.length < 2) errs.outcomes = t('validationOutcomesMin')
      form.outcomes.forEach((outcome, index) => {
        if (!outcome.name.trim()) errs[`outcomeName_${index}`] = t('validationOutcomeNameRequired')
        if (outcome.initialLiquidity < 10 || outcome.initialLiquidity > 10000) errs[`outcomeLiquidity_${index}`] = t('validationLiquidityRange')
        if (outcome.priorProbability < 1 || outcome.priorProbability > 99) errs[`outcomePrior_${index}`] = t('validationPriorRange')
      })
    }
    if (form.disputeWindowHours < 1 || form.disputeWindowHours > 720) errs.disputeWindowHours = t('validationDisputeRange')
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      // Wait for error messages to paint before scrolling/focusing.
      requestAnimationFrame(() => revealFirstInvalidField(errs))
    }
    return Object.keys(errs).length === 0
  }

  const totalLocked = form.marketType === 'MULTI'
    ? form.outcomes.reduce((sum, outcome) => sum + Number(outcome.initialLiquidity || 0), 0)
    : Number(form.initialLiquidity)

  const addOutcome = () => {
    setForm((prev) => ({
      ...prev,
      outcomes: [...prev.outcomes, { name: '', initialLiquidity: 100, priorProbability: 50 }],
    }))
  }

  const removeOutcome = (index: number) => {
    setForm((prev) => {
      if (prev.outcomes.length <= 2) return prev
      return {
        ...prev,
        outcomes: prev.outcomes.filter((_, i) => i !== index),
      }
    })
  }

  const updateOutcome = (index: number, field: 'name' | 'initialLiquidity' | 'priorProbability', value: string | number) => {
    setForm((prev) => ({
      ...prev,
      outcomes: prev.outcomes.map((outcome, i) => i === index ? { ...outcome, [field]: value } : outcome),
    }))
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
          priorProbability: Number(form.priorProbability) / 100,
          outcomes: form.marketType === 'MULTI'
            ? form.outcomes.map((outcome) => ({
                name: outcome.name.trim(),
                initialLiquidity: Number(outcome.initialLiquidity),
                priorProbability: Number(outcome.priorProbability) / 100,
              }))
            : [],
        }),
      })
      const data = await res.json()
      if (res.ok) {
        clearErrorToastTimeout()
        toast.dismiss(CREATE_MARKET_ERROR_TOAST_ID)
        optimisticUpdateBalance(totalLocked)
        toast.success(t('toastCreated'))
        // After market creation the logical "back" is always the markets list.
        // Do NOT use document.referrer — it reflects the last *hard* navigation and
        // is stale after client-side route changes, which can point to another
        // user's market detail page across login/logout cycles.
        try {
          window.sessionStorage.setItem('predictify:post-create-back-target', '/')
        } catch {
          // Ignore storage failures.
        }
        // Hard navigation avoids stalled client-side transitions on mobile
        // when router.push fires from a deep async callback.
        // Brief delay lets the success toast render before the page unloads.
        // Use replace so browser back does not return to the create form.
        const dest = `/markets/${data.market.id}`
        setTimeout(() => { window.location.replace(dest) }, 600)
        return
      } else {
        showCreateErrorToast(data.error || t('toastCreateFailed'))
      }
    } catch {
      showCreateErrorToast(t('toastNetworkError'))
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-2/3" />
        <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
        <div className="h-96 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>
    )
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
        {form.marketType === 'MULTI'
          ? t('multiRiskLocked', { amount: totalLocked })
          : t('riskLocked', { amount: form.initialLiquidity })}
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('marketTypeLabel')}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, marketType: 'BINARY' })}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                form.marketType === 'BINARY'
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
              }`}
            >
              {t('binaryOption')}
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, marketType: 'MULTI' })}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                form.marketType === 'MULTI'
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
              }`}
            >
              {t('multiOption')}
            </button>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('questionLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            name="title"
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
            name="description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('descriptionPlaceholder')}
            rows={4}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description}</p>}
        </div>

        {/* Category & End Date */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              name="endDate"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              min={getLocalDateTimeString(new Date())}
              className="w-full max-w-xs mx-auto text-xs px-1 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            name="resolutionSource"
            value={form.resolutionSource}
            onChange={(e) => setForm({ ...form, resolutionSource: e.target.value })}
            placeholder={t('resolutionPlaceholder')}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.resolutionSource && <p className="text-red-400 text-xs mt-1">{errors.resolutionSource}</p>}
          <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">{t('resolutionHint')}</p>
        </div>

        {form.marketType === 'BINARY' ? (
          <>
            {/* Initial Liquidity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('liquidityLabel')} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="initialLiquidity"
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

            {/* AMM Prior Probability */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('priorLabel')} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="priorProbability"
                min="1"
                max="99"
                step="0.1"
                value={form.priorProbability}
                onChange={(e) => setForm({ ...form, priorProbability: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {errors.priorProbability && <p className="text-red-400 text-xs mt-1">{errors.priorProbability}</p>}
              <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">{t('priorHint')}</p>
            </div>
          </>
        ) : (
          <div className="space-y-3" data-field="outcomes-section">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('outcomesLabel')} <span className="text-red-400">*</span>
              </label>
              <button
                type="button"
                onClick={addOutcome}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                + {t('addOutcome')}
              </button>
            </div>
            {errors.outcomes && <p className="text-red-400 text-xs">{errors.outcomes}</p>}

            {form.outcomes.map((outcome, index) => (
              <div key={`outcome-${index}`} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('outcomeNameLabel')} #{index + 1}</span>
                  {form.outcomes.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOutcome(index)}
                      className="text-xs font-medium text-red-500 hover:underline"
                    >
                      {t('removeOutcome')}
                    </button>
                  )}
                </div>
                <input
                  name={`outcome-${index}-name`}
                  value={outcome.name}
                  onChange={(e) => updateOutcome(index, 'name', e.target.value)}
                  placeholder={t('outcomeNamePlaceholder')}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {errors[`outcomeName_${index}`] && <p className="text-red-400 text-xs">{errors[`outcomeName_${index}`]}</p>}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('outcomeLiquidityLabel')}</label>
                    <input
                      type="number"
                      name={`outcome-${index}-liquidity`}
                      min="10"
                      max="10000"
                      value={outcome.initialLiquidity}
                      onChange={(e) => updateOutcome(index, 'initialLiquidity', Number(e.target.value))}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {errors[`outcomeLiquidity_${index}`] && <p className="text-red-400 text-xs mt-1">{errors[`outcomeLiquidity_${index}`]}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('outcomePriorLabel')}</label>
                    <input
                      type="number"
                      name={`outcome-${index}-prior`}
                      min="1"
                      max="99"
                      step="0.1"
                      value={outcome.priorProbability}
                      onChange={(e) => updateOutcome(index, 'priorProbability', Number(e.target.value))}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {errors[`outcomePrior_${index}`] && <p className="text-red-400 text-xs mt-1">{errors[`outcomePrior_${index}`]}</p>}
                  </div>
                </div>
              </div>
            ))}

            <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">
              {t('liquidityHint', { balance: user.balance.toFixed(2) })}
            </p>
          </div>
        )}

        {/* Dispute Window */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('disputeLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            name="disputeWindowHours"
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
          {t('submit', { amount: totalLocked })}
        </Button>
      </form>
    </div>
  )
}
