/**
 * Market Detail Page - Price Chart Section
 * Shows historical price data with automatic refresh
 * Loads independently as a lower-priority visual section
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { ChartSectionSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { useT } from '@/context/I18nContext'
import { PriceChart } from '@/components/PriceChart'

interface ChartData {
  priceHistory: Array<{
    timestamp: string
    yesPrice: number
    noPrice: number
  }>
}

export function MarketChartSection({
  marketId,
  isPrefetched,
}: {
  marketId: string
  isPrefetched?: boolean
}) {
  const t = useT('marketDetail')

  // Load chart data with medium-frequency refresh
  const { data: chartData, isLoading } = usePageSection<ChartData>({
    key: `market-chart:${marketId}`,
    url: `/api/markets/${marketId}/chart`,
    revalidateInterval: 30_000, // Refresh every 30 seconds
    shouldConsume: isPrefetched,
    debug: false,
  })

  if (isLoading) return <ChartSectionSkeleton />

  if (!chartData || !chartData.priceHistory) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load price history</p>
      </div>
    )
  }

  return (
    <SectionErrorBoundary sectionName="market-chart">
      <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('priceHistoryTitle')}</h2>
        </div>
        <PriceChart data={chartData.priceHistory} />
      </div>
    </SectionErrorBoundary>
  )
}
