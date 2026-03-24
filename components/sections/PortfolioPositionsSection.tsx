/**
 * Portfolio Page - Positions Section
 * Loads open positions table independently
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { TableSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { formatCurrency, getCategoryColor } from '@/lib/utils'
import { useT } from '@/context/I18nContext'
import { Badge } from '@/components/ui/Badge'
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

interface PortfolioPositionsData {
  positions: Position[]
}

export function PortfolioPositionsSection({ isPrefetched = false }: { isPrefetched?: boolean }) {
  const t = useT('portfolio')
  const tCategories = useT('categories')
  const tAdmin = useT('admin')

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

  const translateOutcome = (outcome: string) => {
    switch (outcome) {
      case 'YES': return tAdmin('yes')
      case 'NO': return tAdmin('no')
      case 'INVALID': return tAdmin('invalid')
      default: return outcome
    }
  }

  // Load positions with medium refresh rate
  const { data, isLoading } = usePageSection<PortfolioPositionsData>({
    key: 'portfolio-positions',
    url: '/api/portfolio',
    revalidateInterval: 15000, // Refresh every 15 seconds
    shouldConsume: isPrefetched,
  })

  if (isLoading) return <TableSkeleton rows={5} />

  const positions = data?.positions || []

  if (positions.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-600 dark:text-gray-400">{t('noPositions')}</p>
        <Link href="/" className="text-indigo-500 dark:text-indigo-400 hover:underline text-sm mt-2 inline-block">
          {t('browseMarkets')}
        </Link>
      </div>
    )
  }

  return (
    <SectionErrorBoundary sectionName="portfolio-positions">
      <div className="rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('openPositions')}</h3>

        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th className="px-6 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">
                {t('market')}
              </th>
              <th className="px-6 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">
                Outcome
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                {t('shares')}
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                {t('avgEntry')}
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                Value
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                {t('unrealizedPnl')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {positions.map((position) => (
              <tr
                key={position.id}
                className="hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/markets/${position.market.id}`}
                    className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-xs"
                  >
                    {position.market.title}
                  </Link>
                  <br />
                  <Badge
                    variant="info"
                    className={`mt-1 text-xs ${getCategoryColor(position.market.category)}`}
                  >
                    {translateCategory(position.market.category)}
                  </Badge>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={position.outcome === 'YES' ? 'success' : 'danger'}>
                    {translateOutcome(position.outcome)}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right text-gray-900 dark:text-white font-medium">
                  {position.shares.toFixed(2)}
                </td>
                <td className="px-6 py-4 text-right text-gray-600 dark:text-gray-400">
                  {formatCurrency(position.avgEntryPrice)}
                </td>
                <td className="px-6 py-4 text-right font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(position.currentValue)}
                </td>
                <td className="px-6 py-4 text-right font-semibold">
                  <span
                    className={
                      position.unrealizedPnl >= 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }
                  >
                    {formatCurrency(position.unrealizedPnl)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </SectionErrorBoundary>
  )
}
