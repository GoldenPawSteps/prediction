'use client'

import { useState, useEffect, useCallback } from 'react'
import { use } from 'react'
import { notFound } from 'next/navigation'
import { PriceChart } from '@/components/PriceChart'
import { TradePanel } from '@/components/TradePanel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useI18n, useT } from '@/context/I18nContext'
import { formatQualifiedMajorityLabel, getQualifiedMajorityThreshold, getResolutionQuorum, isImmediateResolutionRound } from '@/lib/resolution'
import { formatCurrency, formatPercent, formatDateTime, getCategoryColor } from '@/lib/utils'
import toast from 'react-hot-toast'

function formatRelativeTime(date: string | Date, locale: string): string {
  const target = new Date(date).getTime()
  const diffMs = target - Date.now()
  const absMs = Math.abs(diffMs)

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })

  if (absMs < minute) return rtf.format(Math.round(diffMs / 1000), 'second')
  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), 'minute')
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), 'hour')
  if (absMs < month) return rtf.format(Math.round(diffMs / day), 'day')
  if (absMs < year) return rtf.format(Math.round(diffMs / month), 'month')
  return rtf.format(Math.round(diffMs / year), 'year')
}

interface Market {
  id: string
  title: string
  description: string
  category: string
  status: string
  resolution: string | null
  resolutionSource: string | null
  resolutionTime?: string | null
  disputeWindowHours?: number
  endDate: string
  totalVolume: number
  ammVolume: number
  exchangeVolume: number
  yesShares: number
  noShares: number
  liquidityParam: number
  probabilities: { yes: number; no: number }
  resolutionVotes: Array<{
    userId: string
    outcome: 'YES' | 'NO' | 'INVALID'
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  disputes: Array<{
    id: string
    proposedOutcome: 'YES' | 'NO' | 'INVALID'
    status: string
    reason: string
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  priceHistory: Array<{ timestamp: string; yesPrice: number; noPrice: number }>
  comments: Array<{ id: string; content: string; createdAt: string; user: { id: string; username: string; avatar: string | null } }>
  creator: { id: string; username: string; avatar: string | null }
  _count: { trades: number }
  disputeCount: number
  tags: string[]
  orders?: Array<{
    id: string; userId: string; outcome: 'YES' | 'NO'; side: 'BID' | 'ASK'
    status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
    price: number; initialShares: number; remainingShares: number; createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  orderFills?: Array<{
    id: string; outcome: 'YES' | 'NO'; price: number; shares: number; createdAt: string
    makerUser: { id: string; username: string; avatar: string | null }
    takerUser: { id: string; username: string; avatar: string | null }
  }>
  userOrders?: Array<{
    id: string; userId: string; outcome: 'YES' | 'NO'; side: 'BID' | 'ASK'
    status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
    orderType?: string
    price: number; initialShares: number; remainingShares: number; filledShares?: number; expiresAt?: string | null; createdAt: string; updatedAt?: string
  }>
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { locale } = useI18n()
  const t = useT('marketDetail')
  const tCategories = useT('categories')
  const tStatus = useT('status')
  const tAdmin = useT('admin')
  const tCard = useT('marketCard')
  const tCommon = useT('common')
  const { id } = use(params)
  const { user, refreshUser } = useAuth()
  const [market, setMarket] = useState<Market | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [resolutionActionLoading, setResolutionActionLoading] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeOutcome, setDisputeOutcome] = useState<'YES' | 'NO' | 'INVALID'>('YES')

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

  const translateStatus = (status: string) => {
    switch (status) {
      case 'OPEN': return tStatus('open')
      case 'CLOSED': return tStatus('closed')
      case 'DISPUTED': return tStatus('disputed')
      case 'INVALID': return tStatus('invalid')
      case 'RESOLVED': return tStatus('resolved')
      default: return status
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

  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${id}`)
      if (res.status === 404) { notFound(); return }
      if (res.ok) {
        const data = await res.json()
        setMarket(data)
      }
    } catch (err) {
      console.error('Failed to fetch market:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchMarket() }, [fetchMarket])

  const handleComment = async () => {
    if (!comment.trim()) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/markets/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: comment }),
      })
      if (res.ok) {
        setComment('')
        fetchMarket()
        toast.success(t('commentPosted'))
      } else {
        const data = await res.json()
        toast.error(data.error || t('commentPostFailed'))
      }
    } catch {
      toast.error(t('networkError'))
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleVote = async (outcome: 'YES' | 'NO' | 'INVALID') => {
    if (!user) {
      toast.error(t('loginToVote'))
      return
    }

    setResolutionActionLoading(true)
    try {
      const res = await fetch(`/api/markets/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ outcome }),
      })
      const data = await res.json()

      if (res.ok) {
        if (data.autoResolved && data.majorityOutcome) {
          toast.success(t('voteRecordedAutoResolved', { outcome: translateOutcome(data.majorityOutcome) }))
          await refreshUser()
        } else {
          toast.success(t('voteRecordedFor', { outcome: translateOutcome(outcome) }))
        }
        await fetchMarket()
      } else {
        toast.error(data.error || t('voteFailed'))
      }
    } catch {
      toast.error(t('networkError'))
    } finally {
      setResolutionActionLoading(false)
    }
  }

  const handleAdminResolve = async (outcome: 'YES' | 'NO' | 'INVALID') => {
    if (!user?.isAdmin) return
    setResolutionActionLoading(true)
    try {
      const res = await fetch(`/api/markets/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ outcome }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(t('marketResolvedAs', { outcome: translateOutcome(outcome) }))
        await refreshUser()
        await fetchMarket()
      } else {
        toast.error(data.error || t('resolutionFailed'))
      }
    } catch {
      toast.error(t('networkError'))
    } finally {
      setResolutionActionLoading(false)
    }
  }

  const handleDispute = async () => {
    if (!user) {
      toast.error(t('loginToDispute'))
      return
    }
    if (disputeReason.trim().length < 20) {
      toast.error(t('disputeReasonMin'))
      return
    }

    setResolutionActionLoading(true)
    try {
      const res = await fetch(`/api/markets/${id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proposedOutcome: disputeOutcome, reason: disputeReason.trim() }),
      })
      const data = await res.json()

      if (res.ok) {
        toast.success(data.message || t('disputeFiledSuccessfully'))
        setDisputeReason('')
        await fetchMarket()
      } else {
        toast.error(data.error || t('disputeFailed'))
      }
    } catch {
      toast.error(t('networkError'))
    } finally {
      setResolutionActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 h-96 bg-gray-200 dark:bg-gray-800 rounded-xl" />
          <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!market) return notFound()

  const isExpired = new Date(market.endDate) < new Date()
  const votingOpen = isExpired && (market.status === 'CLOSED' || market.status === 'OPEN' || market.status === 'DISPUTED')
  const myVote = user ? market.resolutionVotes.find((vote) => vote.userId === user.id)?.outcome : null
  const voteCounts = market.resolutionVotes.reduce(
    (counts, vote) => {
      counts[vote.outcome] += 1
      return counts
    },
    { YES: 0, NO: 0, INVALID: 0 }
  )
  const validVoteTotal = voteCounts.YES + voteCounts.NO
  const totalVoteCount = validVoteTotal + voteCounts.INVALID
  const immediateResolutionRound = isImmediateResolutionRound(market.disputeCount)
  const resolutionQuorum = getResolutionQuorum(market.disputeCount)
  const qualifiedMajorityThreshold = getQualifiedMajorityThreshold(market.disputeCount)
  const qualifiedMajorityFractionLabel = formatQualifiedMajorityLabel(market.disputeCount)
  const nextQualifiedMajorityThreshold = getQualifiedMajorityThreshold(market.disputeCount + 1)
  const nextQualifiedMajorityFractionLabel = formatQualifiedMajorityLabel(market.disputeCount + 1)
  const nextResolutionQuorum = getResolutionQuorum(market.disputeCount + 1)
  const currentDisputeRoundLabel = market.disputeCount === 0
    ? 'Initial resolution round'
    : `Current round: ${getOrdinalLabel(market.disputeCount)} dispute`
  const nextDisputeRoundLabel = `Next round: ${getOrdinalLabel(market.disputeCount + 1)} dispute`
  const qualifiedMajorityPercentLabel = (qualifiedMajorityThreshold * 100).toFixed(1)
  const nextQualifiedMajorityPercentLabel = (nextQualifiedMajorityThreshold * 100).toFixed(1)
  const leadingOutcome = voteCounts.YES === voteCounts.NO
    ? null
    : voteCounts.YES > voteCounts.NO
    ? 'YES'
    : 'NO'
  const leadingVoteCount = leadingOutcome ? voteCounts[leadingOutcome] : 0
  const quorumReached = totalVoteCount >= resolutionQuorum
  const votesNeededForQuorum = Math.max(0, resolutionQuorum - totalVoteCount)
  const validMajorityReached = immediateResolutionRound
    ? Boolean(totalVoteCount > 0 && leadingOutcome)
    : Boolean(quorumReached && leadingOutcome && leadingVoteCount / totalVoteCount > qualifiedMajorityThreshold)
  const invalidMajorityReached = immediateResolutionRound
    ? voteCounts.INVALID > 0
    : quorumReached && voteCounts.INVALID / totalVoteCount > qualifiedMajorityThreshold
  // Progress as share of ALL votes so INVALID votes visibly dilute YES/NO share
  const invalidProgressPercent = totalVoteCount > 0 ? (voteCounts.INVALID / totalVoteCount) * 100 : 0
  const disputeWindowEndsAt = market.resolutionTime && market.disputeWindowHours
    ? new Date(new Date(market.resolutionTime).getTime() + market.disputeWindowHours * 60 * 60 * 1000)
    : null
  const disputeWindowOpen = Boolean(
    market.status === 'RESOLVED' && disputeWindowEndsAt && disputeWindowEndsAt.getTime() > Date.now()
  )
  const resolutionActivity = [
    ...market.resolutionVotes.map((vote) => ({
      id: `vote-${vote.userId}-${vote.createdAt}`,
      createdAt: vote.createdAt,
      tone: vote.outcome === 'YES' ? 'green' : vote.outcome === 'NO' ? 'red' : 'gray',
      title: t('activityVoteTitle', { username: vote.user.username, outcome: translateOutcome(vote.outcome) }),
      description: t('activityVoteDescription'),
    })),
    ...(market.resolution && market.resolutionTime
      ? [{
          id: `resolution-${market.resolutionTime}`,
          createdAt: market.resolutionTime,
          tone: 'indigo',
          title: t('activityResolvedTitle', { outcome: translateOutcome(market.resolution) }),
          description: t('activityResolvedDescription'),
        }]
      : []),
    ...market.disputes.map((dispute) => ({
      id: `dispute-${dispute.id}`,
      createdAt: dispute.createdAt,
      tone: 'yellow',
      title: t('activityDisputeTitle', { username: dispute.user.username, outcome: translateOutcome(dispute.proposedOutcome) }),
      description: dispute.reason,
    })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${getCategoryColor(market.category)}`}>
            {translateCategory(market.category)}
          </span>
          {market.status !== 'OPEN' && (
            <Badge variant={market.status === 'RESOLVED' ? 'info' : market.status === 'INVALID' ? 'danger' : 'warning'}>
              {translateStatus(market.status)} {market.resolution ? `(${translateOutcome(market.resolution)})` : ''}
            </Badge>
          )}
          {market.tags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">#{tag}</span>
          ))}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{market.title}</h1>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500 dark:text-gray-500">
          <span>{t('createdBy')}: <span className="text-gray-600 dark:text-gray-400">@{market.creator.username}</span></span>
          <span>{tAdmin('ends')}: {formatDateTime(market.endDate)} {isExpired ? `(${tCard('expired')})` : ''}</span>
          <span>{market._count.trades} {tCommon('trades')}</span>
          <span>{tCard('vol')}: {formatCurrency(market.totalVolume)}</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Probability Card */}
          <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('currentProbability')}</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-green-900/30 border border-green-700/30 rounded-lg p-3 text-center">
                <div className="text-3xl font-bold text-green-400">{formatPercent(market.probabilities.yes)}</div>
                <div className="text-sm text-green-600 mt-1">{tAdmin('yes')}</div>
              </div>
              <div className="bg-red-900/30 border border-red-700/30 rounded-lg p-3 text-center">
                <div className="text-3xl font-bold text-red-400">{formatPercent(market.probabilities.no)}</div>
                <div className="text-sm text-red-600 mt-1">{tAdmin('no')}</div>
              </div>
            </div>
            <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                style={{ width: `${market.probabilities.yes * 100}%` }}
              />
            </div>
          </div>

          {/* Price Chart */}
          <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">{t('priceHistoryTitle')}</h2>
            <PriceChart data={market.priceHistory} />
          </div>

          {/* Exchange Order History */}
          {((market.orderFills && market.orderFills.length > 0) || (market.userOrders && market.userOrders.length > 0)) && (
            <ExchangeHistoryPanel orderFills={market.orderFills ?? []} userOrders={market.userOrders ?? []} />
          )}

          {/* Description */}
          <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{t('aboutThisMarket')}</h2>
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{market.description}</p>
            {market.resolutionSource && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-500 dark:text-gray-500">{t('resolutionSourceLabel')}: </span>
                <a href={market.resolutionSource} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:underline break-all">
                  {market.resolutionSource}
                </a>
              </div>
            )}
          </div>

          {/* Resolution Center */}
          {(votingOpen || market.status === 'RESOLVED' || market.status === 'DISPUTED') && (
            <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('resolutionCenter')}</h2>
                {votingOpen && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {t('tradingClosedVotingOpen')}
                  </p>
                )}
                {market.status === 'RESOLVED' && disputeWindowOpen && disputeWindowEndsAt && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {t('resolvedAsDisputesOpenUntil', {
                      outcome: translateOutcome(market.resolution || 'INVALID'),
                      date: formatDateTime(disputeWindowEndsAt.toISOString()),
                    })}
                  </p>
                )}
                {market.status === 'DISPUTED' && (
                  <p className="text-sm text-yellow-400 mt-1">
                    {t('underDisputeRound', { round: getOrdinalLabel(market.disputeCount), quorum: resolutionQuorum, threshold: qualifiedMajorityFractionLabel })}
                    {user?.isAdmin && ` ${t('adminOverrideAvailable')}`}
                  </p>
                )}
              </div>

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

              <div className="rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{t('leadingOutcome')}</span>
                  <span className="text-gray-900 dark:text-white font-medium">
                    {invalidMajorityReached
                      ? t('invalidHasMajority', { invalid: voteCounts.INVALID, total: totalVoteCount })
                      : leadingOutcome
                      ? t('leadingOutcomeVotes', {
                          outcome: translateOutcome(leadingOutcome),
                          leading: leadingVoteCount,
                          total: totalVoteCount,
                          percent: totalVoteCount > 0 ? Math.round(leadingVoteCount / totalVoteCount * 100) : 0,
                        })
                      : totalVoteCount > 0
                      ? t('noOutcomeMajorityYet')
                      : t('noVotesYet')}
                  </span>
                </div>
                {totalVoteCount > 0 && (
                  <>
                    {/* Stacked progress bar: YES | NO | INVALID */}
                    <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden flex">
                      <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${totalVoteCount > 0 ? (voteCounts.YES / totalVoteCount) * 100 : 0}%` }} />
                      <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${totalVoteCount > 0 ? (voteCounts.NO / totalVoteCount) * 100 : 0}%` }} />
                      <div className="h-full bg-gray-400 transition-all duration-500" style={{ width: `${invalidProgressPercent}%` }} />
                    </div>
                    {/* Threshold marker */}
                    <div className="relative h-1">
                      <div
                        className="absolute top-0 w-0.5 h-3 bg-yellow-400 -translate-y-1"
                        style={{ left: `${qualifiedMajorityThreshold * 100}%` }}
                        title={t('qualifiedMajorityThresholdTooltip', { percent: qualifiedMajorityPercentLabel })}
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {immediateResolutionRound
                        ? t('firstVoteResolvesMarket')
                        : !quorumReached
                        ? t('quorumNotReachedYet', { count: votesNeededForQuorum })
                        : validMajorityReached
                        ? t('outcomeWillAutoResolve', { outcome: translateOutcome(leadingOutcome || 'INVALID') })
                        : invalidMajorityReached
                        ? t('invalidWillAutoResolve')
                        : t('noOutcomeExceededThresholdYet', {
                            threshold: qualifiedMajorityFractionLabel,
                            percent: qualifiedMajorityPercentLabel,
                          })}
                    </p>
                  </>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-500">{t('totalVotesCast', { count: totalVoteCount })}</p>
              </div>

              <div className="rounded-lg bg-indigo-950/20 border border-indigo-700/30 p-3">
                <h3 className="text-sm font-semibold text-indigo-300">{t('howAutoResolutionWorks')}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  {immediateResolutionRound
                    ? t('initialRoundFirstVoteRule')
                    : t('disputeRoundThresholdRule', {
                        quorum: resolutionQuorum,
                        threshold: qualifiedMajorityFractionLabel,
                        percent: qualifiedMajorityPercentLabel,
                        yes: tAdmin('yes'),
                        no: tAdmin('no'),
                        invalid: tAdmin('invalid'),
                      })}
                  {!immediateResolutionRound && ` ${t('exactThresholdNotEnough')}`} {t('invalidVotesDiluteShares', { yes: tAdmin('yes'), no: tAdmin('no') })}
                </p>
              </div>

              {myVote && (
                <p className="text-sm text-indigo-300">
                  {t('yourCurrentVote')} <span className="font-semibold">{myVote}</span>
                </p>
              )}

              {votingOpen && (
                user ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={() => handleVote('YES')} loading={resolutionActionLoading}>
                      {t('voteYes')}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleVote('NO')} loading={resolutionActionLoading}>
                      {t('voteNo')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleVote('INVALID')} loading={resolutionActionLoading}>
                      {t('voteInvalid')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('loginToVoteAfterEnd')}</p>
                )
              )}

              {user?.isAdmin && market.status === 'DISPUTED' && (
                <div className="border-t border-yellow-700/40 pt-4 space-y-3">
                  <div className="rounded-lg bg-yellow-900/20 border border-yellow-700/40 p-3">
                    <h3 className="text-sm font-semibold text-yellow-300 mb-1">{t('adminOverrideTitle')}</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                      {t('adminOverrideDescription')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" size="sm" onClick={() => handleAdminResolve('YES')} loading={resolutionActionLoading}>
                        {t('resolveYes')}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleAdminResolve('NO')} loading={resolutionActionLoading}>
                        {t('resolveNo')}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => handleAdminResolve('INVALID')} loading={resolutionActionLoading}>
                        {t('resolveInvalid')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {market.status === 'RESOLVED' && disputeWindowOpen && (
                user ? (
                  <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('disputeProposedOutcome')}</label>
                      <select
                        value={disputeOutcome}
                        onChange={(e) => setDisputeOutcome(e.target.value as 'YES' | 'NO' | 'INVALID')}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="YES">{tAdmin('yes')}</option>
                        <option value="NO">{tAdmin('no')}</option>
                        <option value="INVALID">{tAdmin('invalid')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('disputeReason')}</label>
                      <textarea
                        value={disputeReason}
                        onChange={(e) => setDisputeReason(e.target.value)}
                        rows={4}
                        placeholder={t('disputeReasonPlaceholder')}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{t('disputeMinimumHint')}</p>
                      <div className="mt-2 rounded-md bg-yellow-950/30 border border-yellow-700/30 p-3 space-y-1">
                        <p className="text-xs text-yellow-100">
                          {currentDisputeRoundLabel}
                        </p>
                        <p className="text-xs text-yellow-200">
                          {immediateResolutionRound
                            ? t('currentRuleFirstVoteResolves')
                            : t('currentRuleQuorumThreshold', {
                                quorum: resolutionQuorum,
                                threshold: qualifiedMajorityFractionLabel,
                                percent: qualifiedMajorityPercentLabel,
                              })}
                        </p>
                        <p className="text-xs text-yellow-100 pt-1">
                          {nextDisputeRoundLabel}
                        </p>
                        <p className="text-xs text-yellow-300">
                          {t('afterDisputeFiledRule', {
                            quorum: nextResolutionQuorum,
                            threshold: nextQualifiedMajorityFractionLabel,
                            percent: nextQualifiedMajorityPercentLabel,
                          })}
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDispute} loading={resolutionActionLoading}>
                      {t('fileDispute')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-4">
                    {t('loginToDisputeOpenWindow')}
                  </p>
                )
              )}

              {market.disputes.length > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('recentDisputes')}</h3>
                  {market.disputes.map((dispute) => (
                    <div key={dispute.id} className="rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/60 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-700 dark:text-gray-300">{t('proposed')}: <span className="font-semibold text-gray-900 dark:text-white">{translateOutcome(dispute.proposedOutcome)}</span></span>
                        <span className="text-xs text-gray-500 dark:text-gray-500">{formatRelativeTime(dispute.createdAt, locale)}</span>
                      </div>
                      <p className="text-gray-600 dark:text-gray-400 mt-2">{dispute.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {resolutionActivity.length > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('resolutionActivity')}</h3>
                  <div className="space-y-3">
                    {resolutionActivity.map((item) => (
                      <div key={item.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={`mt-1 h-2.5 w-2.5 rounded-full ${
                              item.tone === 'green'
                                ? 'bg-green-400'
                                : item.tone === 'red'
                                ? 'bg-red-400'
                                : item.tone === 'yellow'
                                ? 'bg-yellow-400'
                                : item.tone === 'indigo'
                                ? 'bg-indigo-400'
                                : 'bg-gray-400'
                            }`}
                          />
                          <div className="mt-1 h-full w-px bg-gray-300 dark:bg-gray-700 last:hidden" />
                        </div>
                        <div className="flex-1 rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{item.title}</p>
                            <div className="text-right text-xs text-gray-500 dark:text-gray-500 shrink-0">
                              <div>{formatRelativeTime(item.createdAt, locale)}</div>
                              <div>{formatDateTime(item.createdAt)}</div>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comments */}
          <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              {t('discussion')} ({market.comments.length})
            </h2>

            {user && (
              <div className="flex gap-2 mb-4">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleComment() }}
                  placeholder={t('shareThoughts')}
                  className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Button size="sm" onClick={handleComment} loading={submittingComment}>{t('post')}</Button>
              </div>
            )}

            {market.comments.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-500 text-sm text-center py-4">{t('noCommentsYet')}</p>
            ) : (
              <div className="space-y-3">
                {market.comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {c.user.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">@{c.user.username}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-500">{formatRelativeTime(c.createdAt, locale)}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          <TradePanel market={market} onTradeComplete={fetchMarket} />

          {/* Market Stats */}
          <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 text-sm space-y-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">{t('marketStatsTitle')}</h3>
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>{t('totalVolumeLabel')}</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(market.totalVolume)}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-400 pl-3 border-l border-gray-300 dark:border-gray-700">
              <span>{t('ammVolumeLabel')}</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(market.ammVolume)}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-400 pl-3 border-l border-gray-300 dark:border-gray-700">
              <span>{t('exchangeVolumeLabel')}</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(market.exchangeVolume)}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>{t('totalTradesLabel')}</span>
              <span className="text-gray-900 dark:text-white">{market._count.trades}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>{t('endDateLabel')}</span>
              <span className="text-gray-900 dark:text-white">{formatDateTime(market.endDate)}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>{t('statusLabel')}</span>
              <span className="text-gray-900 dark:text-white">{translateStatus(market.status)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getOrdinalLabel(value: number) {
  const teenRemainder = value % 100
  if (teenRemainder >= 11 && teenRemainder <= 13) return `${value}th`

  const remainder = value % 10
  if (remainder === 1) return `${value}st`
  if (remainder === 2) return `${value}nd`
  if (remainder === 3) return `${value}rd`
  return `${value}th`
}

type Fill = {
  id: string; outcome: 'YES' | 'NO'; price: number; shares: number; createdAt: string
  makerUser: { id: string; username: string; avatar: string | null }
  takerUser: { id: string; username: string; avatar: string | null }
}

type UserOrder = {
  id: string; userId: string; outcome: 'YES' | 'NO'; side: 'BID' | 'ASK'
  status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
  orderType?: string
  price: number; initialShares: number; remainingShares: number; filledShares?: number; expiresAt?: string | null; createdAt: string; updatedAt?: string
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  OPEN: 'text-blue-400',
  PARTIAL: 'text-yellow-400',
  FILLED: 'text-green-400',
  CANCELLED: 'text-gray-500',
}

function ExchangeHistoryPanel({ orderFills, userOrders }: { orderFills: Fill[]; userOrders: UserOrder[] }) {
  const [tab, setTab] = useState<'fills' | 'orders'>('fills')
  const { locale } = useI18n()
  const t = useT('marketDetail')
  const tAdmin = useT('admin')
  const tTradePanel = useT('tradePanel')
  const tPortfolio = useT('portfolio')

  const translateOutcome = (outcome: 'YES' | 'NO' | 'INVALID') => {
    if (outcome === 'YES') return tAdmin('yes')
    if (outcome === 'NO') return tAdmin('no')
    return tAdmin('invalid')
  }

  const translateOrderStatus = (status: UserOrder['status']) => {
    if (status === 'OPEN') return t('orderStatusOpen')
    if (status === 'PARTIAL') return t('orderStatusPartial')
    if (status === 'FILLED') return t('orderStatusFilled')
    return t('orderStatusCancelled')
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('exchangeHistoryTitle')}</h2>
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden text-xs">
          <button
            onClick={() => setTab('fills')}
            className={`px-3 py-1.5 font-medium ${tab === 'fills' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            {tTradePanel('recentFills', { outcome: `${tAdmin('yes')}/${tAdmin('no')}` })}
          </button>
          {userOrders.length > 0 && (
            <button
              onClick={() => setTab('orders')}
              className={`px-3 py-1.5 font-medium ${tab === 'orders' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
            >
              {tTradePanel('openOrders')}
            </button>
          )}
        </div>
      </div>

      {tab === 'fills' && (
        orderFills.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-500 text-center py-4">{tTradePanel('noRecentFills')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 dark:text-gray-500 border-b border-gray-300 dark:border-gray-700">
                  <th className="pb-2 text-left font-medium">{tPortfolio('date')}</th>
                  <th className="pb-2 text-left font-medium">{t('outcomeLabel')}</th>
                  <th className="pb-2 text-right font-medium">{tPortfolio('price')}</th>
                  <th className="pb-2 text-right font-medium">{tPortfolio('shares')}</th>
                  <th className="pb-2 text-right font-medium">{t('notionalLabel')}</th>
                  <th className="pb-2 text-left font-medium pl-4">{t('makerLabel')}</th>
                  <th className="pb-2 text-left font-medium">{t('takerLabel')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300 dark:divide-gray-700/50">
                {orderFills.map((fill) => (
                  <tr key={fill.id} className="text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/20 transition-colors">
                    <td className="py-1.5 text-gray-500 dark:text-gray-500">{formatRelativeTime(fill.createdAt, locale)}</td>
                    <td className="py-1.5">
                      <span className={`font-medium ${fill.outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                        {translateOutcome(fill.outcome)}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono">{formatPercent(fill.price)}</td>
                    <td className="py-1.5 text-right font-mono">{fill.shares.toFixed(2)}</td>
                    <td className="py-1.5 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(fill.price * fill.shares)}</td>
                    <td className="py-1.5 pl-4 text-gray-600 dark:text-gray-400">@{fill.makerUser.username}</td>
                    <td className="py-1.5 text-gray-600 dark:text-gray-400">@{fill.takerUser.username}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'orders' && (
        <div className="space-y-2">
          {userOrders.map((order) => {
            const filledShares = Math.max(0, Number(order.filledShares ?? 0))
            const fillPct = order.initialShares > 0 ? (filledShares / order.initialShares) * 100 : 0
            return (
              <div key={order.id} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${order.side === 'BID' ? 'text-green-400' : 'text-red-400'}`}>
                      {order.side === 'BID' ? tTradePanel('bidBuy') : tTradePanel('askSell')}
                    </span>
                    <span className={`font-medium ${order.outcome === 'YES' ? 'text-green-300' : 'text-red-300'}`}>
                      {translateOutcome(order.outcome)}
                    </span>
                    {order.orderType && order.orderType !== 'GTC' && (
                      <span className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1 rounded text-[10px]">{order.orderType}</span>
                    )}
                    <span className="text-gray-900 dark:text-white font-mono">
                      {formatPercent(order.price)}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">{order.initialShares.toFixed(2)} {tPortfolio('shares').toLowerCase()}</span>
                  </div>
                  <span className={`font-medium ${ORDER_STATUS_COLORS[order.status]}`}>{translateOrderStatus(order.status)}</span>
                </div>

                {/* Fill progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-gray-500 dark:text-gray-500">
                    <span>{tTradePanel('filledLabel', { filled: filledShares.toFixed(2), total: order.initialShares.toFixed(2) })}</span>
                    <span>{fillPct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        order.status === 'FILLED' ? 'bg-green-500' : order.status === 'CANCELLED' ? 'bg-gray-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                </div>

                {/* Status timeline */}
                <div className="flex flex-wrap gap-3 text-gray-500 dark:text-gray-500 pt-1">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 inline-block" />
                    {t('placedLabel')} {formatRelativeTime(order.createdAt, locale)}
                  </span>
                  {order.orderType === 'GTD' && order.expiresAt && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 inline-block" />
                      {tTradePanel('expiresLabel', { date: formatDateTime(order.expiresAt) })}
                    </span>
                  )}
                  {order.status === 'FILLED' && order.updatedAt && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />
                      {t('filledAtLabel')} {formatRelativeTime(order.updatedAt, locale)}
                    </span>
                  )}
                  {order.status === 'PARTIAL' && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 inline-block" />
                      {t('partialFillLabel')}
                    </span>
                  )}
                  {order.status === 'CANCELLED' && order.updatedAt && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />
                      {t('cancelledLabel')} {formatRelativeTime(order.updatedAt, locale)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
