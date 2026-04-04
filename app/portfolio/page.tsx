'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { finishAdminNavMetric } from '@/lib/client-nav-metrics'
import { PortfolioSummarySection } from '@/components/sections/PortfolioSummarySection'
import { PortfolioPositionsSection } from '@/components/sections/PortfolioPositionsSection'
import { PortfolioTradesSection } from '@/components/sections/PortfolioTradesSection'


export default function PortfolioPage() {
  const t = useT('portfolio')
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions')
  const hasLoggedNavMetricRef = useRef(false)

  useEffect(() => {
    if (!user || hasLoggedNavMetricRef.current) return

    finishAdminNavMetric('/portfolio', user.isAdmin, 'Portfolio loaded')
    hasLoggedNavMetricRef.current = true
  }, [user])
  if (!user) {
    return (
      <div className="text-center py-16 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-white/60 dark:bg-gray-900/40">
        <p className="text-gray-600 dark:text-gray-400 mb-4">{t('loginPrompt')}</p>
        <a href="/auth/login" className="text-indigo-500 dark:text-indigo-400 hover:underline">{t('loginLink')}</a>
      </div>
    )
  }


  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/95 dark:bg-gray-900/90 p-4 sm:p-6 transform-gpu">
        <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-white break-words leading-snug">{t('title')}</h1>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">@{user.username}</p>
      </div>

        {/* Portfolio Summary Section - Loads independently */}
        <PortfolioSummarySection isPrefetched={false} />

      {/* Tabs */}
      <div className="inline-flex gap-0.5 sm:gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-0.5 sm:p-1 border border-gray-200 dark:border-gray-700">
        {(['positions', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium capitalize transition-colors rounded-lg ${
              activeTab === tab
                ? 'text-white bg-indigo-600 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
              {tab === 'positions' ? t('openPositions') : t('tradeHistory')}
          </button>
        ))}
      </div>

        {/* Positions Section - Loads independently */}
        {activeTab === 'positions' && <PortfolioPositionsSection isPrefetched={false} />}

        {/* Trade History Section - Loads independently */}
        {activeTab === 'history' && <PortfolioTradesSection isPrefetched={false} />}
    </div>
  )
}
