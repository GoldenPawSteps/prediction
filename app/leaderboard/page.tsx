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
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">{t('subtitle')}</p>
          </div>
          <div className="inline-flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 border border-gray-200 dark:border-gray-700">
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSortBy(opt.value)
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sortBy === opt.value
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
          </div>
        </div>
      </div>

      <LeaderboardTableSection sortBy={sortBy} isPrefetched={false} />
    </div>
  )
}
