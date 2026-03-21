'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency, formatPercent, formatDateTime, getCategoryColor } from '@/lib/utils'
import Link from 'next/link'

interface Position {
  id: string
  outcome: string
  shares: number
  avgEntryPrice: number
  currentPrice: number
  currentValue: number
  unrealizedPnl: number
  realizedPnl: number
  market: {
    id: string
    title: string
    status: string
    resolution: string | null
    category: string
    endDate: string
  }
}

interface Trade {
  id: string
  outcome: string
  type: string
  shares: number
  price: number
  totalCost: number
  createdAt: string
  market: { id: string; title: string; category: string }
}

interface Stats {
  totalPositions: number
  totalValue: number
  totalUnrealizedPnl: number
  totalRealizedPnl: number
}

export default function PortfolioPage() {
  const { user } = useAuth()
  const [positions, setPositions] = useState<Position[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions')

  useEffect(() => {
    if (!user) return
    fetch('/api/portfolio')
      .then((r) => r.json())
      .then((data) => {
        setPositions(data.positions || [])
        setTrades(data.trades || [])
        setStats(data.stats || null)
      })
      .finally(() => setLoading(false))
  }, [user])

  if (!user) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 mb-4">Please log in to view your portfolio.</p>
        <a href="/auth/login" className="text-indigo-400 hover:underline">Log in →</a>
      </div>
    )
  }

  if (loading) {
    return <div className="animate-pulse space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-800 rounded-xl" />)}
    </div>
  }

  const totalPnl = (stats?.totalRealizedPnl || 0) + (stats?.totalUnrealizedPnl || 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="text-gray-400 mt-1">@{user.username}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Balance</p>
          <p className="text-xl font-bold text-white mt-1">{formatCurrency(user.balance)}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Portfolio Value</p>
          <p className="text-xl font-bold text-white mt-1">{formatCurrency(stats?.totalValue || 0)}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Unrealized P&L</p>
          <p className={`text-xl font-bold mt-1 ${(stats?.totalUnrealizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(stats?.totalUnrealizedPnl || 0)}
          </p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Total P&L</p>
          <p className={`text-xl font-bold mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(totalPnl)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {(['positions', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'text-white border-indigo-500'
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            {tab === 'positions' ? `Open Positions (${positions.length})` : 'Trade History'}
          </button>
        ))}
      </div>

      {/* Positions */}
      {activeTab === 'positions' && (
        positions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-3">📊</div>
            <p>No open positions yet.</p>
            <Link href="/" className="text-indigo-400 hover:underline text-sm mt-2 block">Browse markets →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((p) => (
              <Link key={p.id} href={`/markets/${p.market.id}`}>
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 hover:border-indigo-500/50 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${getCategoryColor(p.market.category)}`}>{p.market.category}</span>
                        <Badge variant={p.outcome === 'YES' ? 'success' : 'danger'}>{p.outcome}</Badge>
                      </div>
                      <p className="text-white font-medium text-sm line-clamp-1">{p.market.title}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-semibold ${p.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {p.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(p.unrealizedPnl)}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">Unrealized P&L</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3 text-xs text-gray-500">
                    <div>
                      <p>Shares</p>
                      <p className="text-gray-300 font-medium">{p.shares.toFixed(2)}</p>
                    </div>
                    <div>
                      <p>Avg. Entry</p>
                      <p className="text-gray-300 font-medium">{formatPercent(p.avgEntryPrice)}</p>
                    </div>
                    <div>
                      <p>Current</p>
                      <p className="text-gray-300 font-medium">{formatPercent(p.currentPrice)}</p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      )}

      {/* Trade History */}
      {activeTab === 'history' && (
        trades.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-3">📜</div>
            <p>No trades yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  <th className="pb-2 font-medium">Market</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Shares</th>
                  <th className="pb-2 font-medium">Price</th>
                  <th className="pb-2 font-medium">Total</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {trades.map((t) => (
                  <tr key={t.id} className="text-gray-300">
                    <td className="py-2">
                      <Link href={`/markets/${t.market.id}`} className="hover:text-white line-clamp-1 max-w-xs block">
                        {t.market.title}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        t.type === 'BUY' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                      }`}>
                        {t.type} {t.outcome}
                      </span>
                    </td>
                    <td className="py-2">{t.shares.toFixed(2)}</td>
                    <td className="py-2">{formatPercent(t.price)}</td>
                    <td className="py-2">{formatCurrency(Math.abs(t.totalCost))}</td>
                    <td className="py-2 text-gray-500">{formatDateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
