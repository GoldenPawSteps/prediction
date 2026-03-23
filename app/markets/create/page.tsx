'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import toast from 'react-hot-toast'

const CATEGORIES = ['Politics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Finance', 'Other']

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
    if (form.title.length < 10) errs.title = 'Title must be at least 10 characters'
    if (form.description.length < 20) errs.description = 'Description must be at least 20 characters'
    if (!form.endDate) errs.endDate = 'End date is required'
    else if (new Date(form.endDate) <= new Date()) errs.endDate = 'End date must be after the current date and time'
    if (!form.resolutionSource) errs.resolutionSource = 'Resolution source URL is required'
    else if (!form.resolutionSource.startsWith('http')) errs.resolutionSource = 'Must be a valid URL'
    if (form.initialLiquidity < 10 || form.initialLiquidity > 10000) errs.initialLiquidity = 'Liquidity must be between $10 and $10,000'
    if (form.disputeWindowHours < 1 || form.disputeWindowHours > 720) errs.disputeWindowHours = 'Dispute window must be between 1 and 720 hours'
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
        toast.success('Market created!')
        router.push(`/markets/${data.market.id}`)
      } else {
        toast.error(data.error || 'Failed to create market')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 mb-4">Please log in to create a market.</p>
        <a href="/auth/login" className="text-indigo-400 hover:underline">Log in →</a>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Create Prediction Market</h1>
        <p className="text-gray-400 mt-1">Create a market for others to trade on.</p>
      </div>

      {/* Risk Warning */}
      <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4 mb-6 text-sm text-yellow-200">
        ⚠️ <strong>Risk Warning:</strong> Prediction markets involve financial risk. Only use funds you can afford to lose.
        Your initial liquidity of <strong>${form.initialLiquidity}</strong> will be locked until market resolution.
      </div>

      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Market Question <span className="text-red-400">*</span>
          </label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Will Bitcoin exceed $100,000 by Dec 31, 2026?"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.title && <p className="text-red-400 text-xs mt-1">{errors.title}</p>}
          <p className="text-gray-500 text-xs mt-1">{form.title.length}/200 characters</p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the market, resolution criteria, and any relevant context..."
            rows={4}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description}</p>}
        </div>

        {/* Category & End Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              End Date <span className="text-red-400">*</span>
            </label>
            <input
              type="datetime-local"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              min={getLocalDateTimeString(new Date())}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {errors.endDate && <p className="text-red-400 text-xs mt-1">{errors.endDate}</p>}
          </div>
        </div>

        {/* Resolution Source */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Resolution Source URL <span className="text-red-400">*</span>
          </label>
          <input
            type="url"
            value={form.resolutionSource}
            onChange={(e) => setForm({ ...form, resolutionSource: e.target.value })}
            placeholder="https://example.com/news/article"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.resolutionSource && <p className="text-red-400 text-xs mt-1">{errors.resolutionSource}</p>}
          <p className="text-gray-500 text-xs mt-1">Where will the outcome be determined?</p>
        </div>

        {/* Initial Liquidity */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Initial Liquidity ($) <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            min="10"
            max="10000"
            value={form.initialLiquidity}
            onChange={(e) => setForm({ ...form, initialLiquidity: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.initialLiquidity && <p className="text-red-400 text-xs mt-1">{errors.initialLiquidity}</p>}
          <p className="text-gray-500 text-xs mt-1">
            Your balance: ${user.balance.toFixed(2)} | Higher liquidity = less price impact per trade
          </p>
        </div>

        {/* Dispute Window */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Dispute Window (hours) <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            min="1"
            max="720"
            value={form.disputeWindowHours}
            onChange={(e) => setForm({ ...form, disputeWindowHours: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {errors.disputeWindowHours && <p className="text-red-400 text-xs mt-1">{errors.disputeWindowHours}</p>}
          <p className="text-gray-500 text-xs mt-1">
            Time window for disputing resolution (1-720 hours, default: 24). Users can file disputes within this period after resolution.
          </p>
        </div>

        {/* Tags */}
        <Input
          label="Tags (optional)"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="bitcoin, crypto, 2026"
          hint="Comma-separated tags"
        />

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Create Market (costs ${form.initialLiquidity})
        </Button>
      </form>
    </div>
  )
}
