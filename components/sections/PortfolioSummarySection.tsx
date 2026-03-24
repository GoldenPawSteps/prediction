/**
 * Portfolio Page - Summary Stats Section
 * Loads portfolio statistics independently with high refresh rate
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { TableSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { formatCurrency } from '@/lib/utils'
import { useT } from '@/context/I18nContext'

interface PortfolioStats {
  positions: Array<{
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
  }>
  trades: Array<{
    id: string
    outcome: string
    type: string
    shares: number
    price: number
    totalCost: number
    createdAt: string
    market: { id: string; title: string; category: string }
  }>
  stats: {
    totalPositions: number
    totalValue: number
    totalUnrealizedPnl: number
    totalRealizedPnl: number
  }
}

export function PortfolioSummarySection({ isPrefetched = false }: { isPrefetched?: boolean }) {
  const t = useT('portfolio')

  // Load portfolio data with frequent refresh (user-facing)
  const { data, isLoading } = usePageSection<PortfolioStats>({
    key: 'portfolio-summary',
    url: '/api/portfolio',
    revalidateInterval: 8000, // Refresh every 8 seconds for user-facing stats
    shouldConsume: isPrefetched,
  })

  if (isLoading) return <TableSkeleton rows={4} />

  const stats = data?.stats

  if (!stats) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load portfolio summary</p>
      </div>
    )
  }

  const totalPnl = stats.totalRealizedPnl + stats.totalUnrealizedPnl

  return (
    <SectionErrorBoundary sectionName="portfolio-summary">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('portfolioValue')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {formatCurrency(stats.totalValue)}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('unrealizedPnl')}</p>
          <p
            className={`text-2xl font-bold mt-1 ${
              stats.totalUnrealizedPnl >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {formatCurrency(stats.totalUnrealizedPnl)}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('totalPnl')}</p>
          <p
            className={`text-2xl font-bold mt-1 ${
              totalPnl >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {formatCurrency(totalPnl)}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('openPositions')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats.totalPositions}</p>
        </div>
      </div>
    </SectionErrorBoundary>
  )
}
