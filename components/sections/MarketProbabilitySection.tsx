/**
 * Market Detail Page - Probability Section
 * Demonstrates progressive per-section loading
 * Renders instantly if prefetched, shows skeleton otherwise
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { ProbabilityCardSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { useT } from '@/context/I18nContext'
import { formatPercent } from '@/lib/utils'

interface ProbabilityData {
  yes: number
  no: number
}

export function MarketProbabilitySection({
  marketId,
  isPrefetched,
}: {
  marketId: string
  isPrefetched?: boolean
}) {
  const t = useT('marketDetail')
  const tAdmin = useT('admin')

  // Load probability data with automatic background refresh
  const { data: probabilities, isLoading } = usePageSection<ProbabilityData>({
    key: `market-prob:${marketId}`,
    url: `/api/markets/${marketId}/probability`,
    revalidateInterval: 5000, // Refresh probabilities every 5 seconds
    shouldConsume: isPrefetched,
    debug: true,
  })

  if (isLoading) return <ProbabilityCardSkeleton />

  if (!probabilities) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load probabilities</p>
      </div>
    )
  }

  return (
    <SectionErrorBoundary sectionName="market-probability">
      <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('currentProbability')}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-green-900/30 border border-green-700/30 rounded-lg p-3 text-center">
            <div className="text-3xl font-bold text-green-400">{formatPercent(probabilities.yes)}</div>
            <div className="text-sm text-green-600 mt-1">{tAdmin('yes')}</div>
          </div>
          <div className="bg-red-900/30 border border-red-700/30 rounded-lg p-3 text-center">
            <div className="text-3xl font-bold text-red-400">{formatPercent(probabilities.no)}</div>
            <div className="text-sm text-red-600 mt-1">{tAdmin('no')}</div>
          </div>
        </div>

        <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
            style={{ width: `${probabilities.yes * 100}%` }}
          />
        </div>
      </div>
    </SectionErrorBoundary>
  )
}
