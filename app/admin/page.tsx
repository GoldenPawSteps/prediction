'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { useT } from '@/context/I18nContext'

interface Market {
  id: string
  title: string
  category: string
  status: string
  totalVolume: number
  endDate: string
  probabilities: { yes: number; no: number }
  _count: { trades: number }
}

export default function AdminPage() {
  const t = useT('admin')
  const tCategories = useT('categories')
  const tStatus = useT('status')
  const { user, refreshUser } = useAuth()
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

  const translateCategory = (category: string) => {
    switch (category) {
      case 'Politics': return tCategories('politics')
      case 'Crypto': return tCategories('crypto')
      case 'Sports': return tCategories('sports')
      case 'Tech': return tCategories('tech')
      case 'Entertainment': return tCategories('entertainment')
      case 'Science': return tCategories('science')
      case 'Finance': return tCategories('finance')
      case 'Other': return tCategories('other')
      default: return category
    }
  }

  const translateStatus = (status: string) => {
    switch (status) {
      case 'OPEN': return tStatus('open')
      case 'CLOSED': return tStatus('closed')
      case 'DISPUTED': return tStatus('disputed')
      case 'INVALID': return tStatus('invalid')
      case 'RESOLVED': return tStatus('resolved')
      default: return status
    }
  }

  useEffect(() => {
    if (!user?.isAdmin) return
    fetch('/api/markets?status=all&limit=100')
      .then((r) => r.json())
      .then((d) => setMarkets(d.markets || []))
      .finally(() => setLoading(false))
  }, [user])

  const handleResolve = async (marketId: string, outcome: string) => {
    setResolving(marketId + outcome)
    try {
      const res = await fetch(`/api/markets/${marketId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, definitive: true }),
      })
      const data = await res.json()

      if (res.ok) {
        toast.success(t('toastResolved', { outcome }))
        setMarkets((prev) => prev.map((m) => m.id === marketId ? { ...m, status: outcome === 'INVALID' ? 'INVALID' : 'RESOLVED' } : m))
        await refreshUser()
      } else {
        toast.error(data.error || t('toastFailed'))
      }
    } catch {
      toast.error(t('toastNetworkError'))
    } finally {
      setResolving(null)
    }
  }

  if (!user?.isAdmin) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400">{t('accessDenied')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-3">
          {markets.map((market) => (
            <div key={market.id} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <Link href={`/markets/${market.id}`} className="text-gray-900 dark:text-white font-medium hover:text-indigo-400 line-clamp-1">
                    {market.title}
                  </Link>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    <span>{translateCategory(market.category)}</span>
                    <span>{t('vol')}: {formatCurrency(market.totalVolume)}</span>
                    <span>{market._count.trades} {t('trades')}</span>
                    <span>{t('yes')}: {formatPercent(market.probabilities.yes)}</span>
                    <span>{t('ends')}: {formatDate(market.endDate)}</span>
                    <span className={`font-medium ${
                      market.status === 'OPEN' ? 'text-green-400' :
                      market.status === 'RESOLVED' ? 'text-blue-400' : 'text-gray-400'
                    }`}>{translateStatus(market.status)}</span>
                  </div>
                </div>
                {market.status === 'OPEN' && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={resolving === market.id + 'YES'}
                      onClick={() => handleResolve(market.id, 'YES')}
                    >{t('yes')}</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={resolving === market.id + 'NO'}
                      onClick={() => handleResolve(market.id, 'NO')}
                    >{t('no')}</Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={resolving === market.id + 'INVALID'}
                      onClick={() => handleResolve(market.id, 'INVALID')}
                    >{t('invalid')}</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
