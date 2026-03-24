'use client'

import { useState, useEffect, useRef } from 'react'
import { useT } from '@/context/I18nContext'
import { finishAdminNavMetric } from '@/lib/client-nav-metrics'
import { useAuth } from '@/context/AuthContext'
import { LeaderboardTableSection } from '@/components/sections/LeaderboardTableSection'


export default function LeaderboardPage() {
  const t = useT('leaderboard')
  const { user } = useAuth()
  const [sortBy, setSortBy] = useState('profit')
  const hasLoggedNavMetricRef = useRef(false)

  const sortOptions = [
    { value: 'profit', label: t('sortByProfit') },
    { value: 'roi', label: t('sortByRoi') },
    { value: 'trades', label: t('sortByTrades') },
  ]


  useEffect(() => {
    if (hasLoggedNavMetricRef.current) return

    finishAdminNavMetric('/leaderboard', user?.isAdmin, 'Leaderboard loaded')
    hasLoggedNavMetricRef.current = true
  }, [user?.isAdmin])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSortBy(opt.value)
              }}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                sortBy === opt.value ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <LeaderboardTableSection sortBy={sortBy} isPrefetched={false} />
    </div>
  )
}
