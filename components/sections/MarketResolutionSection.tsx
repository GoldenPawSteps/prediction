/**
 * Market Detail Page - Resolution Center Section  
 * Shows voting status and resolution progress
 * Loads independently with auto-refresh for live vote tracking
 */

'use client'

import { usePageSection } from '@/lib/client-page-section'
import { ResolutionActivitySkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { useAuth } from '@/context/AuthContext'
import { useI18n, useT } from '@/context/I18nContext'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime, formatDateTime } from '@/lib/utils'
import toast from 'react-hot-toast'

interface ResolutionData {
  status: string
  resolution: string | null
  resolutionTime: string | null
  disputeWindowHours: number
  resolutionVotes: Array<{
    userId: string
    outcome: string
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  disputes: Array<{
    id: string
    proposedOutcome: string
    status: string
    reason: string
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  endDate: string
}

export function MarketResolutionSection({
  marketId,
  isPrefetched,
}: {
  marketId: string
  isPrefetched?: boolean
}) {
  const { user } = useAuth()
  const { locale } = useI18n()
  const t = useT('marketDetail')
  const tAdmin = useT('admin')

  // Load resolution data with frequent background refresh (vote tracking)
  const { data: resolution, isLoading } = usePageSection<ResolutionData>({
    key: `market-resolution:${marketId}`,
    url: `/api/markets/${marketId}/resolution`,
    revalidateInterval: 3000, // Refresh every 3 seconds for live vote tracking
    shouldConsume: isPrefetched,
    debug: false,
  })

  if (isLoading) return <ResolutionActivitySkeleton />

  if (!resolution) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load resolution data</p>
      </div>
    )
  }

  const isExpired = new Date(resolution.endDate) < new Date()
  const votingOpen = isExpired && (resolution.status === 'CLOSED' || resolution.status === 'OPEN' || resolution.status === 'DISPUTED')
  const myVote = user ? resolution.resolutionVotes.find((vote) => vote.userId === user.id)?.outcome : null

  const voteCounts = resolution.resolutionVotes.reduce(
    (counts, vote) => {
      if (vote.outcome === 'YES' || vote.outcome === 'NO' || vote.outcome === 'INVALID') {
        counts[vote.outcome] += 1
      }
      return counts
    },
    { YES: 0, NO: 0, INVALID: 0 }
  )

  const totalVotes = resolution.resolutionVotes.length

  return (
    <SectionErrorBoundary sectionName="market-resolution">
      <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('resolutionCenter')}</h2>
        </div>

        {votingOpen && (
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('tradingClosedVotingOpen')}</p>
        )}

        {/* Vote Counts */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-green-900/20 border border-green-700/30 p-3 text-center">
            <div className="text-green-400 font-semibold">{tAdmin('yes')}</div>
            <div className="text-gray-900 dark:text-white text-lg font-bold">{voteCounts.YES}</div>
          </div>
          <div className="rounded-lg bg-red-900/20 border border-red-700/30 p-3 text-center">
            <div className="text-red-400 font-semibold">{tAdmin('no')}</div>
            <div className="text-gray-900 dark:text-white text-lg font-bold">{voteCounts.NO}</div>
          </div>
          <div className="rounded-lg bg-gray-200 dark:bg-gray-700/40 border border-gray-300 dark:border-gray-600/40 p-3 text-center">
            <div className="text-gray-700 dark:text-gray-300 font-semibold">{tAdmin('invalid')}</div>
            <div className="text-gray-900 dark:text-white text-lg font-bold">{voteCounts.INVALID}</div>
          </div>
        </div>

        {/* Vote Progress Bar */}
        {totalVotes > 0 && (
          <div className="space-y-2">
            <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden flex">
              <div className="h-full bg-green-500 transition-all" style={{ width: `${(voteCounts.YES / totalVotes) * 100}%` }} />
              <div className="h-full bg-red-500 transition-all" style={{ width: `${(voteCounts.NO / totalVotes) * 100}%` }} />
              <div className="h-full bg-gray-400 transition-all" style={{ width: `${(voteCounts.INVALID / totalVotes) * 100}%` }} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500">{t('totalVotesCast', { count: totalVotes })}</p>
          </div>
        )}

        {myVote && (
          <p className="text-sm text-indigo-300">{t('yourCurrentVote')} <span className="font-semibold">{myVote}</span></p>
        )}

        {/* Recent Activity */}
        {resolution.resolutionVotes.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('resolutionActivity')}</h3>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {resolution.resolutionVotes.slice(0, 5).map((vote) => (
                <div key={`${vote.userId}-${vote.createdAt}`} className="text-xs text-gray-600 dark:text-gray-400 flex justify-between">
                  <span>
                    @{vote.user.username} voted{' '}
                    <span className={vote.outcome === 'YES' ? 'text-green-400' : vote.outcome === 'NO' ? 'text-red-400' : 'text-gray-400'}>
                      {vote.outcome}
                    </span>
                  </span>
                  <span className="text-gray-500">{formatRelativeTime(vote.createdAt, locale)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionErrorBoundary>
  )
}
