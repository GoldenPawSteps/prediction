/**
 * Portfolio Page - Summary Stats Section
 * Loads portfolio statistics independently with high refresh rate
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { TableSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { formatCurrency, formatPercent, formatRelativeTime } from '@/lib/utils'
import { useT } from '@/context/I18nContext'
import { useErrorToast } from '@/lib/useErrorToast'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'
import { beginNavFeedback } from '@/lib/client-nav-feedback'

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
  reservedOrders: Array<{
    id: string
    marketId: string
    outcome: string
    orderType: string
    price: number
    initialShares: number
    remainingShares: number
    reservedAmount: number
    expiresAt: string | null
    createdAt: string
    market: { id: string; title: string }
  }>
  stats: {
    availableBalance: number
    reservedBalance: number
    totalPositions: number
    totalValue: number
    totalUnrealizedPnl: number
    totalRealizedPnl: number
  }
}

export function PortfolioSummarySection({ isPrefetched = false }: { isPrefetched?: boolean }) {
  const t = useT('portfolio')
  const tTradePanel = useT('tradePanel')
  const tAdmin = useT('admin')

  const translateOutcome = (outcome: string) => {
    switch (outcome) {
      case 'YES': return tAdmin('yes')
      case 'NO': return tAdmin('no')
      case 'INVALID': return tAdmin('invalid')
      default: return outcome
    }
  }

  // Load portfolio data with frequent refresh (user-facing)
  const { data, isLoading, error } = usePageSection<PortfolioStats>({
    key: 'portfolio-summary',
    url: '/api/portfolio',
    revalidateInterval: 8000, // Refresh every 8 seconds for user-facing stats
    shouldConsume: isPrefetched,
  })
  useErrorToast(error, 'Failed to load portfolio summary')

  if (isLoading) return <TableSkeleton rows={4} />

  const stats = data?.stats
  const reservedOrders = data?.reservedOrders || []

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
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('availableBalance')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {formatCurrency(stats.availableBalance)}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('reservedBalance')}</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            {formatCurrency(stats.reservedBalance)}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('portfolioValue')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {formatCurrency(stats.totalValue)}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
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

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
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

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('openPositions')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats.totalPositions}</p>
        </div>
        </div>

        {reservedOrders.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('reservedBalance')}</h3>
              <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                {formatCurrency(stats.reservedBalance)}
              </span>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {reservedOrders.map((order) => (
                <div key={order.id} className="px-3 sm:px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/markets/${order.market.id}`}
                      onClick={() => beginNavFeedback(`/markets/${order.market.id}`)}
                      className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline break-words"
                    >
                      {order.market.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={order.outcome === 'YES' ? 'success' : 'danger'}>
                        {translateOutcome(order.outcome)}
                      </Badge>
                      <Badge variant="info">{tTradePanel('bidBuy')}</Badge>
                      {order.orderType !== 'GTC' && <Badge variant="default">{order.orderType}</Badge>}
                      {order.orderType === 'GTD' && order.expiresAt && (
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {tTradePanel('gtdLabel', { time: formatRelativeTime(order.expiresAt) })}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                      {order.remainingShares.toFixed(2)} / {order.initialShares.toFixed(2)} {t('shares').toLowerCase()} @ {formatPercent(order.price)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {formatCurrency(order.reservedAmount)}
                    </p>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      {tTradePanel('reserveHint', { amount: formatCurrency(order.reservedAmount) })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionErrorBoundary>
  )
}
