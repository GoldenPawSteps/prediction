'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

interface LeaderboardEntry {
  id: string
  username: string
  avatar: string | null
  balance: number
  totalRealizedPnl: number
  roi: number
  totalTrades: number
}

const SORT_OPTIONS = [
  { value: 'profit', label: 'Total Profit' },
  { value: 'roi', label: 'Best ROI' },
  { value: 'trades', label: 'Most Active' },
]

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('profit')

  useEffect(() => {
    fetch(`/api/leaderboard?sortBy=${sortBy}`)
      .then((r) => r.json())
      .then((data) => setEntries(data))
      .finally(() => setLoading(false))
  }, [sortBy])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
          <p className="text-gray-400 mt-1">Top traders on Predictify</p>
        </div>
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setLoading(true)
                setSortBy(opt.value)
              }}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                sortBy === opt.value ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">🏆</div>
          <p>No traders yet. Be the first!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                index === 0 ? 'bg-yellow-900/20 border-yellow-700/30' :
                index === 1 ? 'bg-gray-400/10 border-gray-600/30' :
                index === 2 ? 'bg-orange-900/15 border-orange-700/20' :
                'bg-gray-800/50 border-gray-700/50'
              }`}
            >
              {/* Rank */}
              <div className="w-8 text-center font-bold">
                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (
                  <span className="text-gray-400 text-sm">#{index + 1}</span>
                )}
              </div>

              {/* Avatar */}
              <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                {entry.username[0].toUpperCase()}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium">@{entry.username}</p>
                <p className="text-gray-500 text-xs">{entry.totalTrades} trades</p>
              </div>

              {/* Stats */}
              <div className="text-right">
                <p className={`font-semibold ${entry.totalRealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {entry.totalRealizedPnl >= 0 ? '+' : ''}{formatCurrency(entry.totalRealizedPnl)}
                </p>
                <p className={`text-xs ${entry.roi >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ROI: {entry.roi >= 0 ? '+' : ''}{entry.roi.toFixed(1)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
