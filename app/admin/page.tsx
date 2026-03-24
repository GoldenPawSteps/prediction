'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import Link from 'next/link'

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
  const { user, refreshUser } = useAuth()
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

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
        body: JSON.stringify({ outcome }),
      })
      const data = await res.json()

      if (res.ok) {
        const refunded = data?.settlement?.refundedToCreator ?? 0
        if (refunded > 0) {
          toast.success(`Resolved as ${outcome}. Returned ${formatCurrency(refunded)} to creator.`)
        } else {
          toast.success(`Resolved as ${outcome}`)
        }
        setMarkets((prev) => prev.map((m) => m.id === marketId ? { ...m, status: 'RESOLVED' } : m))
        await refreshUser()
      } else {
        toast.error(data.error || 'Failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setResolving(null)
    }
  }

  if (!user?.isAdmin) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400">You need admin access to view this page.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">Manage and resolve prediction markets</p>
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
                    <span>{market.category}</span>
                    <span>Vol: {formatCurrency(market.totalVolume)}</span>
                    <span>{market._count.trades} trades</span>
                    <span>YES: {formatPercent(market.probabilities.yes)}</span>
                    <span>Ends: {formatDate(market.endDate)}</span>
                    <span className={`font-medium ${
                      market.status === 'OPEN' ? 'text-green-400' :
                      market.status === 'RESOLVED' ? 'text-blue-400' : 'text-gray-400'
                    }`}>{market.status}</span>
                  </div>
                </div>
                {market.status === 'OPEN' && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={resolving === market.id + 'YES'}
                      onClick={() => handleResolve(market.id, 'YES')}
                    >YES</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={resolving === market.id + 'NO'}
                      onClick={() => handleResolve(market.id, 'NO')}
                    >NO</Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={resolving === market.id + 'INVALID'}
                      onClick={() => handleResolve(market.id, 'INVALID')}
                    >Invalid</Button>
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
