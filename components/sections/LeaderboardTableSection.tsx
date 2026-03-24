/**
 * Leaderboard Page - Table Section
 * Loads leaderboard entries independently with auto-refresh
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { TableSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { useT } from '@/context/I18nContext'
import { useAuth } from '@/context/AuthContext'
import { Badge } from '@/components/ui/Badge'

interface LeaderboardEntry {
  id: string
  username: string
  avatar: string | null
  balance: number
  totalRealizedPnl: number
  roi: number
  totalTrades: number
  totalWins?: number
  winRate?: number
}

interface LeaderboardData {
  entries: LeaderboardEntry[]
  timestamp: string
}

export function LeaderboardTableSection({
  sortBy = 'profit',
  isPrefetched = false,
}: {
  sortBy?: string
  isPrefetched?: boolean
}) {
  const t = useT('leaderboard')
  const { user } = useAuth()

  const { data, isLoading } = usePageSection<LeaderboardData>({
    key: `leaderboard-table:${sortBy}`,
    url: `/api/leaderboard?sortBy=${sortBy}`,
    revalidateInterval: 15000, // Refresh every 15 seconds
    shouldConsume: isPrefetched,
  })

  if (isLoading) return <TableSkeleton rows={6} />

  const entries = data?.entries || []

  if (entries.length === 0) {
    return (
      <SectionErrorBoundary sectionName="leaderboard-table">
        <div className="text-center py-16 text-gray-500 dark:text-gray-500 rounded-lg border border-gray-200 dark:border-gray-800">
          <div className="text-4xl mb-3">🏆</div>
          <p>{t('noTraders')} {t('noTradersHint')}</p>
        </div>
      </SectionErrorBoundary>
    )
  }

  return (
    <SectionErrorBoundary sectionName="leaderboard-table">
      <div className="rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('title')}</h3>

        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th className="px-6 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">
                #
              </th>
              <th className="px-6 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">
                Trader
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                PnL
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                {t('roi')}
              </th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                Trades
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {entries.map((entry, idx) => (
              <tr
                key={entry.id}
                className={`hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors ${
                  user?.id === entry.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                }`}
              >
                <td className="px-6 py-4">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {entry.avatar && (
                      <img
                        src={entry.avatar}
                        alt={entry.username}
                        className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800"
                      />
                    )}
                    <span className="text-gray-900 dark:text-white font-medium">{entry.username}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className={entry.totalRealizedPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                    {formatCurrency(entry.totalRealizedPnl)}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <Badge
                    variant={entry.roi >= 0 ? 'success' : 'danger'}
                    className="justify-end"
                  >
                    {formatPercent(entry.roi)}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right text-gray-600 dark:text-gray-400">
                  {entry.totalTrades}
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
