'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PriceChart } from '@/components/PriceChart'
import { TradePanel } from '@/components/TradePanel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useI18n, useT } from '@/context/I18nContext'
import { formatQualifiedMajorityLabel, getQualifiedMajorityThreshold, getResolutionQuorum, isImmediateResolutionRound } from '@/lib/resolution'
import { formatCurrency, formatFixed, formatPercent, formatDateTime, getCategoryColor } from '@/lib/utils'
import { consumePrefetchedJson } from '@/lib/client-prefetch'
import { finishAdminNavMetric } from '@/lib/client-nav-metrics'
import { MarketCommentsSection } from '@/components/sections/MarketCommentsSection'
import { useErrorToast } from '@/lib/useErrorToast'
import { MarketDetailLoadingSkeleton } from '@/components/MarketDetailLoadingSkeleton'
import toast from 'react-hot-toast'

const MARKET_FETCH_TIMEOUT_MS = 12000
const MARKET_ACTIVE_POLL_MS = 5000
const MARKET_MIN_INITIAL_LOADING_MS = 180

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, received: ${contentType || 'unknown content type'}`)
  }
  return response.json() as Promise<T>
}

function countActiveUserOrders(market: Market): number {
  const parentOrderCount = (market.userOrders ?? []).filter(
    (order) => ['OPEN', 'PARTIAL'].includes(order.status) && order.remainingShares > 0
  ).length

  const outcomeOrderCount = (market.outcomes ?? []).reduce((sum, outcome) => {
    const activeOrders = (outcome.userOrders ?? []).filter(
      (order) => ['OPEN', 'PARTIAL'].includes(order.status) && order.remainingShares > 0
    ).length

    return sum + activeOrders
  }, 0)

  return parentOrderCount + outcomeOrderCount
}

function shouldPollMarket(market: Market | null): boolean {
  if (!market) return false

  return market.status === 'OPEN' || countActiveUserOrders(market) > 0
}

function getNextUserGtdExpiryDelayMs(market: Market): number | null {
  const now = Date.now()

  const collectDelays = (orders: Array<{ status: string; orderType?: string; remainingShares: number; expiresAt?: string | null }>) =>
    orders
      .filter((order) => {
        if (!['OPEN', 'PARTIAL'].includes(order.status)) return false
        if (order.orderType !== 'GTD') return false
        if (order.remainingShares <= 0) return false
        return Boolean(order.expiresAt)
      })
      .map((order) => Math.max(0, new Date(order.expiresAt as string).getTime() - now))

  const parentDelays = collectDelays(market.userOrders ?? [])
  const outcomeDelays = (market.outcomes ?? []).flatMap((outcome) => collectDelays(outcome.userOrders ?? []))
  const allDelays = [...parentDelays, ...outcomeDelays]

  if (allDelays.length === 0) return null
  return Math.min(...allDelays)
}

function getMarketCloseDelayMs(market: Market): number | null {
  if (market.status !== 'OPEN') return null
  if (countActiveUserOrders(market) === 0) return null
  const now = Date.now()
  const endDateMs = new Date(market.endDate).getTime()
  if (!Number.isFinite(endDateMs) || endDateMs <= now) return null
  return endDateMs - now
}

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

export interface Market {
  id: string
  title: string
  marketType?: 'BINARY' | 'MULTI'
  parentMarketId?: string | null
  outcomeName?: string | null
  parent?: { id: string; title: string; marketType: 'BINARY' | 'MULTI' } | null
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
  outcomes?: Array<{
    id: string
    title: string
    outcomeName: string | null
    status: string
    resolution: string | null
    resolutionTime?: string | null
    disputeWindowHours?: number
    disputeCount?: number
    totalVolume: number
    endDate: string
    yesShares: number
    noShares: number
    liquidityParam: number
    probabilities: { yes: number; no: number }
    _count: { trades: number; comments: number; disputes: number }
    resolutionVotes: Array<{
      userId: string
      outcome: 'YES' | 'NO' | 'INVALID'
      createdAt: string
    }>
    disputes: Array<{
      id: string
      proposedOutcome: 'YES' | 'NO' | 'INVALID'
      status: string
      reason: string
      createdAt: string
      user: { id: string; username: string; avatar: string | null }
    }>
    orders?: Array<{
      id: string
      userId: string
      outcome: 'YES' | 'NO'
      side: 'BID' | 'ASK'
      status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
      orderType?: string
      price: number
      initialShares: number
      remainingShares: number
      expiresAt?: string | null
      createdAt: string
      user: { id: string; username: string; avatar: string | null }
    }>
    orderFills?: Array<{
      id: string
      outcome: 'YES' | 'NO'
      price: number
      shares: number
      createdAt: string
      makerUser: { id: string; username: string; avatar: string | null }
      takerUser: { id: string; username: string; avatar: string | null }
    }>
    userOrders?: Array<{
      id: string
      userId: string
      outcome: 'YES' | 'NO'
      side: 'BID' | 'ASK'
      status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
      orderType?: string
      price: number
      initialShares: number
      remainingShares: number
      filledShares?: number
      expiresAt?: string | null
      createdAt: string
      updatedAt?: string
    }>
  }>
  resolutionVotes: Array<{
    userId: string
    outcome: 'YES' | 'NO' | 'INVALID'
    createdAt: string
    user: { id: string; username: string; avatar: string | null }
  }>
  voteHistory: Array<{
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

export function MarketDetailPageClient({
  marketId,
  initialMarket = null,
}: {
  marketId: string
  initialMarket?: Market | null
}) {
  const id = marketId
  const { locale } = useI18n()
  const t = useT('marketDetail')
  const tCategories = useT('categories')
  const tStatus = useT('status')
  const tAdmin = useT('admin')
  const tCard = useT('marketCard')
  const tCommon = useT('common')
  const { user, refreshUser } = useAuth()
  const [market, setMarket] = useState<Market | null>(initialMarket)
  const [loading, setLoading] = useState(!initialMarket)
  const [fetchError, setFetchError] = useState<unknown>(null)
  const [isNotFound, setIsNotFound] = useState(false)
  const [resolutionActionLoading, setResolutionActionLoading] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeOutcome, setDisputeOutcome] = useState<'YES' | 'NO' | 'INVALID'>('YES')
  const [outcomeResolutionLoadingId, setOutcomeResolutionLoadingId] = useState<string | null>(null)
  const [outcomeDisputeReason, setOutcomeDisputeReason] = useState<Record<string, string>>({})
  const [outcomeDisputeOutcome, setOutcomeDisputeOutcome] = useState<Record<string, 'YES' | 'NO' | 'INVALID'>>({})
  const [expandedOutcomeResolution, setExpandedOutcomeResolution] = useState<Record<string, boolean>>({})
  const hasLoggedNavMetricRef = useRef(false)
  const previousStatusRef = useRef<string | null>(initialMarket?.status ?? null)
  const previousActiveUserOrdersRef = useRef<number | null>(
    initialMarket ? countActiveUserOrders(initialMarket) : null
  )
  const userRef = useRef(user)
  const marketJsonRef = useRef<string | null>(initialMarket ? JSON.stringify(initialMarket) : null)
  const fetchInFlightRef = useRef<Promise<void> | null>(null)
  const queuedFetchRef = useRef(false)
  const initialLoadStartedAtRef = useRef<number>(Date.now())
  const initialLoadReleasedRef = useRef(false)

  const releaseInitialLoading = useCallback(() => {
    if (initialLoadReleasedRef.current) return
    initialLoadReleasedRef.current = true

    const elapsed = Date.now() - initialLoadStartedAtRef.current
    const remaining = Math.max(0, MARKET_MIN_INITIAL_LOADING_MS - elapsed)

    window.setTimeout(() => {
      setLoading(false)
    }, remaining)
  }, [])

  useEffect(() => {
    userRef.current = user
  }, [user])

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
    if (fetchInFlightRef.current) {
      queuedFetchRef.current = true
      return fetchInFlightRef.current
    }

    const run = async () => {
      const prefetchKey = `market:${id}`
      const prefetched = consumePrefetchedJson<Market>(prefetchKey)
      const hasPrefetched = Boolean(prefetched)

      if (prefetched) {
        const prefetchedJson = JSON.stringify(prefetched)
        if (prefetchedJson !== marketJsonRef.current) {
          marketJsonRef.current = prefetchedJson
          setMarket(prefetched)
        }
        releaseInitialLoading()
      }

      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), MARKET_FETCH_TIMEOUT_MS)

        try {
          const res = await fetch(`/api/markets/${id}`, {
            cache: 'no-store',
            signal: controller.signal,
          })

          if (res.status === 404) {
            setIsNotFound(true)
            return
          }

          if (res.ok) {
            const data = await readJsonResponse<Market>(res)
            const activeUserOrders = countActiveUserOrders(data)
            const marketJustClosed = previousStatusRef.current === 'OPEN' && data.status !== 'OPEN'
            const userOrdersReleased = previousActiveUserOrdersRef.current !== null
              && previousActiveUserOrdersRef.current > activeUserOrders

            previousStatusRef.current = data.status
            previousActiveUserOrdersRef.current = activeUserOrders

            setFetchError(null)

            const nextMarketJson = JSON.stringify(data)
            if (nextMarketJson !== marketJsonRef.current) {
              marketJsonRef.current = nextMarketJson
              setMarket(data)
            }

            if (userRef.current && (marketJustClosed || userOrdersReleased)) {
              void refreshUser()
            }
          } else {
            setFetchError('Failed to fetch market')
          }
        } finally {
          window.clearTimeout(timeoutId)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setFetchError(new Error('Timed out while fetching market'))
        } else {
          setFetchError(err)
        }
        console.error('Failed to fetch market:', err)
      } finally {
        releaseInitialLoading()
      }
    }

    fetchInFlightRef.current = run().finally(() => {
      fetchInFlightRef.current = null

      if (queuedFetchRef.current) {
        queuedFetchRef.current = false
        void fetchMarket()
      }
    })

    return fetchInFlightRef.current
  }, [id, refreshUser, releaseInitialLoading])

  useErrorToast(fetchError, 'Failed to fetch market')

  useEffect(() => {
    initialLoadStartedAtRef.current = Date.now()
    initialLoadReleasedRef.current = false
    setLoading(true)
    fetchMarket()
  }, [fetchMarket])

  useEffect(() => {
    if (!shouldPollMarket(market)) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchMarket()
      }
    }, MARKET_ACTIVE_POLL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchMarket, market])

  useEffect(() => {
    if (!market || !user) {
      return
    }

    const nextExpiryDelay = getNextUserGtdExpiryDelayMs(market)
    if (nextExpiryDelay === null) {
      return
    }

    // refreshUser() processes all stale orders (GTD + market-expired)
    // server-side, so balance is fresh in the response.
    const timeoutId = window.setTimeout(() => {
      void refreshUser()
      void fetchMarket()
    }, nextExpiryDelay + 200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fetchMarket, market, refreshUser, user])

  useEffect(() => {
    if (!market || !user) {
      return
    }

    const closeDelay = getMarketCloseDelayMs(market)
    if (closeDelay === null) {
      return
    }

    // When the market closes, active BID orders get refunded.
    // refreshUser() handles this server-side in auth/me.
    const timeoutId = window.setTimeout(() => {
      void refreshUser()
      void fetchMarket()
    }, closeDelay + 200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fetchMarket, market, refreshUser, user])

  useEffect(() => {
    if (loading || !market || hasLoggedNavMetricRef.current) return

    finishAdminNavMetric(`/markets/${id}`, user?.isAdmin, 'Market detail data')
    hasLoggedNavMetricRef.current = true
  }, [id, loading, market, user?.isAdmin])



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

  const handleOutcomeVote = async (outcomeMarketId: string, outcome: 'YES' | 'NO' | 'INVALID') => {
    if (!user) {
      toast.error(t('loginToVote'))
      return
    }

    setOutcomeResolutionLoadingId(outcomeMarketId)
    try {
      const res = await fetch(`/api/markets/${outcomeMarketId}/vote`, {
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
      setOutcomeResolutionLoadingId(null)
    }
  }

  const handleOutcomeAdminResolve = async (outcomeMarketId: string, outcome: 'YES' | 'NO' | 'INVALID') => {
    if (!user?.isAdmin) return

    setOutcomeResolutionLoadingId(outcomeMarketId)
    try {
      const res = await fetch(`/api/markets/${outcomeMarketId}/resolve`, {
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
      setOutcomeResolutionLoadingId(null)
    }
  }

  const handleOutcomeDispute = async (outcomeMarketId: string) => {
    if (!user) {
      toast.error(t('loginToDispute'))
      return
    }

    const reason = outcomeDisputeReason[outcomeMarketId]?.trim() || ''
    if (reason.length < 20) {
      toast.error(t('disputeReasonMin'))
      return
    }

    const proposedOutcome = outcomeDisputeOutcome[outcomeMarketId] || 'YES'

    setOutcomeResolutionLoadingId(outcomeMarketId)
    try {
      const res = await fetch(`/api/markets/${outcomeMarketId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proposedOutcome, reason }),
      })
      const data = await res.json()

      if (res.ok) {
        toast.success(data.message || t('disputeFiledSuccessfully'))
        setOutcomeDisputeReason((prev) => ({ ...prev, [outcomeMarketId]: '' }))
        await fetchMarket()
      } else {
        toast.error(data.error || t('disputeFailed'))
      }
    } catch {
      toast.error(t('networkError'))
    } finally {
      setOutcomeResolutionLoadingId(null)
    }
  }

  if (loading) {
    return <MarketDetailLoadingSkeleton />
  }

  if (isNotFound || !market) return notFound()

  const isMultiMarket = market.marketType === 'MULTI'
  const outcomeMarkets = market.outcomes ?? []
  const aggregateTrades = isMultiMarket
    ? outcomeMarkets.reduce((sum, outcome) => sum + outcome._count.trades, 0)
    : market._count.trades

  const isExpired = new Date(market.endDate) < new Date()
  const votingOpen = !isMultiMarket && isExpired && (market.status === 'CLOSED' || market.status === 'OPEN' || market.status === 'DISPUTED')
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
    // Use the immutable vote history so changed votes both appear in the
    // timeline. Fall back to resolutionVotes for markets that predate the
    // history table (no history rows yet).
    ...(market.voteHistory?.length ? market.voteHistory : market.resolutionVotes).map((vote) => ({
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
    <div className="space-y-8">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm p-4 sm:p-6">
        <div className="pointer-events-none absolute -top-16 -right-14 h-44 w-44 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-2 mb-2">
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
        <h1 className="relative text-xl sm:text-3xl font-bold text-gray-900 dark:text-white break-words leading-snug">{market.title}</h1>
        {market.parent && (
          <div className="relative mt-2 text-sm text-gray-500 dark:text-gray-500">
            {t('parentMarketLabel')}: <Link href={`/markets/${market.parent.id}`} className="text-indigo-500 dark:text-indigo-300 hover:underline">{market.parent.title}</Link>
          </div>
        )}
        <div className="relative flex flex-wrap gap-2 mt-2 text-xs sm:text-sm text-gray-500 dark:text-gray-500">
          <span>{t('createdBy')}: <span className="text-gray-600 dark:text-gray-400">@{market.creator.username}</span></span>
          <span>{tAdmin('ends')}: {formatDateTime(market.endDate)} {isExpired ? `(${tCard('expired')})` : ''}</span>
          <span>{aggregateTrades} {tCommon('trades')}</span>
          <span>{tCard('vol')}: {formatCurrency(market.totalVolume)}</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {isMultiMarket ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('outcomesTitle')}</h2>
                {outcomeMarkets.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('noOutcomesFound')}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:gap-6">
                    {outcomeMarkets.map((outcome) => {
                      const outcomeIsExpired = new Date(outcome.endDate) < new Date()
                      const outcomeVotingOpen = outcomeIsExpired
                        && (outcome.status === 'CLOSED' || outcome.status === 'OPEN' || outcome.status === 'DISPUTED')
                      const outcomeMyVote = user
                        ? outcome.resolutionVotes.find((vote) => vote.userId === user.id)?.outcome
                        : null
                      const outcomeVoteCounts = outcome.resolutionVotes.reduce(
                        (counts, vote) => {
                          counts[vote.outcome] += 1
                          return counts
                        },
                        { YES: 0, NO: 0, INVALID: 0 }
                      )
                      const outcomeDisputeCount = outcome.disputeCount ?? outcome._count.disputes
                      const outcomeTotalVotes = outcomeVoteCounts.YES + outcomeVoteCounts.NO + outcomeVoteCounts.INVALID
                      const outcomeImmediateResolutionRound = isImmediateResolutionRound(outcomeDisputeCount)
                      const outcomeResolutionQuorum = getResolutionQuorum(outcomeDisputeCount)
                      const outcomeQualifiedMajorityThreshold = getQualifiedMajorityThreshold(outcomeDisputeCount)
                      const outcomeQualifiedMajorityFractionLabel = formatQualifiedMajorityLabel(outcomeDisputeCount)
                      const outcomeQualifiedMajorityPercentLabel = (outcomeQualifiedMajorityThreshold * 100).toFixed(1)
                      const outcomeLeadingOutcome = outcomeVoteCounts.YES === outcomeVoteCounts.NO
                        ? null
                        : outcomeVoteCounts.YES > outcomeVoteCounts.NO
                        ? 'YES'
                        : 'NO'
                      const outcomeLeadingVoteCount = outcomeLeadingOutcome ? outcomeVoteCounts[outcomeLeadingOutcome] : 0
                      const outcomeQuorumReached = outcomeTotalVotes >= outcomeResolutionQuorum
                      const outcomeVotesNeededForQuorum = Math.max(0, outcomeResolutionQuorum - outcomeTotalVotes)
                      const outcomeValidMajorityReached = outcomeImmediateResolutionRound
                        ? Boolean(outcomeTotalVotes > 0 && outcomeLeadingOutcome)
                        : Boolean(
                            outcomeQuorumReached
                            && outcomeLeadingOutcome
                            && outcomeLeadingVoteCount / outcomeTotalVotes > outcomeQualifiedMajorityThreshold
                          )
                      const outcomeInvalidMajorityReached = outcomeImmediateResolutionRound
                        ? outcomeVoteCounts.INVALID > 0
                        : outcomeQuorumReached && outcomeVoteCounts.INVALID / outcomeTotalVotes > outcomeQualifiedMajorityThreshold
                      const outcomeInvalidProgressPercent = outcomeTotalVotes > 0
                        ? (outcomeVoteCounts.INVALID / outcomeTotalVotes) * 100
                        : 0
                      const outcomeDisputeWindowEndsAt = outcome.resolutionTime && outcome.disputeWindowHours
                        ? new Date(new Date(outcome.resolutionTime).getTime() + outcome.disputeWindowHours * 60 * 60 * 1000)
                        : null
                      const outcomeDisputeWindowOpen = Boolean(
                        outcome.status === 'RESOLVED' && outcomeDisputeWindowEndsAt && outcomeDisputeWindowEndsAt.getTime() > Date.now()
                      )
                      const outcomeResolutionExpanded = Boolean(expandedOutcomeResolution[outcome.id])

                      return (
                      <div key={outcome.id} className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 sm:p-5 shadow-sm">
                        <div className="mb-3 sm:mb-4">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{outcome.outcomeName || outcome.title}</h3>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap items-center gap-2">
                            <span>{tCard('vol')}: {formatCurrency(outcome.totalVolume)} · {outcome._count.trades} {tCommon('trades')}</span>
                            {outcome.status !== 'OPEN' && (
                              <Badge variant={outcome.status === 'RESOLVED' ? 'info' : outcome.status === 'INVALID' ? 'danger' : 'warning'}>
                                {translateStatus(outcome.status)} {outcome.resolution ? `(${translateOutcome(outcome.resolution)})` : ''}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="mb-3 sm:mb-4">
                          <div className="flex flex-col sm:flex-row sm:justify-between text-xs mb-2 gap-1 sm:gap-0">
                            <span className="text-green-400 font-semibold">{tAdmin('yes')} {formatPercent(outcome.probabilities.yes)}</span>
                            <span className="text-red-400 font-semibold">{tAdmin('no')} {formatPercent(outcome.probabilities.no)}</span>
                          </div>
                          <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden mt-1">
                            <div
                              className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                              style={{ width: `${outcome.probabilities.yes * 100}%` }}
                            />
                          </div>
                        </div>
                        <TradePanel
                          market={{
                            id: outcome.id,
                            status: outcome.status,
                            endDate: outcome.endDate,
                            yesShares: outcome.yesShares,
                            noShares: outcome.noShares,
                            liquidityParam: outcome.liquidityParam,
                            probabilities: outcome.probabilities,
                            orders: outcome.orders,
                            orderFills: outcome.orderFills,
                            userOrders: outcome.userOrders,
                          }}
                          onTradeComplete={fetchMarket}
                        />

                        {(outcomeVotingOpen || outcome.status === 'RESOLVED' || outcome.status === 'DISPUTED') && (
                          <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{t('resolutionCenter')}</h4>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setExpandedOutcomeResolution((prev) => ({ ...prev, [outcome.id]: !prev[outcome.id] }))}
                              >
                                {outcomeResolutionExpanded ? t('hideDetails') : t('showDetails')}
                              </Button>
                            </div>

                            {!outcomeResolutionExpanded && (
                              <p className="text-xs text-gray-500 dark:text-gray-500">
                                {t('totalVotesCast', { count: outcomeTotalVotes })}
                              </p>
                            )}

                            {outcomeResolutionExpanded && (
                              <>

                            {outcome.status === 'DISPUTED' && (
                              <p className="text-xs text-yellow-400">
                                {t('underDisputeRound', {
                                  round: getOrdinalLabel(outcomeDisputeCount),
                                  quorum: outcomeResolutionQuorum,
                                  threshold: outcomeQualifiedMajorityFractionLabel,
                                })}
                              </p>
                            )}

                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="rounded-lg bg-green-900/20 border border-green-700/30 p-2 text-center">
                                <div className="text-green-400 font-semibold">{tAdmin('yes')}</div>
                                <div className="text-gray-900 dark:text-white text-base font-bold">{outcomeVoteCounts.YES}</div>
                              </div>
                              <div className="rounded-lg bg-red-900/20 border border-red-700/30 p-2 text-center">
                                <div className="text-red-400 font-semibold">{tAdmin('no')}</div>
                                <div className="text-gray-900 dark:text-white text-base font-bold">{outcomeVoteCounts.NO}</div>
                              </div>
                              <div className="rounded-lg bg-gray-200 dark:bg-gray-700/40 border border-gray-300 dark:border-gray-600/40 p-2 text-center">
                                <div className="text-gray-700 dark:text-gray-300 font-semibold">{tAdmin('invalid')}</div>
                                <div className="text-gray-900 dark:text-white text-base font-bold">{outcomeVoteCounts.INVALID}</div>
                              </div>
                            </div>

                            <div className="rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/60 p-3 space-y-2">
                              <div className="flex items-center justify-between gap-3 text-xs">
                                <span className="text-gray-600 dark:text-gray-400">{t('leadingOutcome')}</span>
                                <span className="text-gray-900 dark:text-white font-medium">
                                  {outcomeInvalidMajorityReached
                                    ? t('invalidHasMajority', { invalid: outcomeVoteCounts.INVALID, total: outcomeTotalVotes })
                                    : outcomeLeadingOutcome
                                    ? t('leadingOutcomeVotes', {
                                        outcome: translateOutcome(outcomeLeadingOutcome),
                                        leading: outcomeLeadingVoteCount,
                                        total: outcomeTotalVotes,
                                        percent: outcomeTotalVotes > 0 ? Math.round(outcomeLeadingVoteCount / outcomeTotalVotes * 100) : 0,
                                      })
                                    : outcomeTotalVotes > 0
                                    ? t('noOutcomeMajorityYet')
                                    : t('noVotesYet')}
                                </span>
                              </div>
                              {outcomeTotalVotes > 0 && (
                                <>
                                  <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden flex">
                                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${(outcomeVoteCounts.YES / outcomeTotalVotes) * 100}%` }} />
                                    <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(outcomeVoteCounts.NO / outcomeTotalVotes) * 100}%` }} />
                                    <div className="h-full bg-gray-400 transition-all duration-500" style={{ width: `${outcomeInvalidProgressPercent}%` }} />
                                  </div>
                                  <div className="relative h-1">
                                    <div
                                      className="absolute top-0 w-0.5 h-3 bg-yellow-400 -translate-y-1"
                                      style={{ left: `${outcomeQualifiedMajorityThreshold * 100}%` }}
                                      title={t('qualifiedMajorityThresholdTooltip', { percent: outcomeQualifiedMajorityPercentLabel })}
                                    />
                                  </div>
                                  <p className="text-xs text-gray-500 dark:text-gray-500">
                                    {outcomeImmediateResolutionRound
                                      ? t('firstVoteResolvesMarket')
                                      : !outcomeQuorumReached
                                      ? t('quorumNotReachedYet', { count: outcomeVotesNeededForQuorum })
                                      : outcomeValidMajorityReached
                                      ? t('outcomeWillAutoResolve', { outcome: translateOutcome(outcomeLeadingOutcome || 'INVALID') })
                                      : outcomeInvalidMajorityReached
                                      ? t('invalidWillAutoResolve')
                                      : t('noOutcomeExceededThresholdYet', {
                                          threshold: outcomeQualifiedMajorityFractionLabel,
                                          percent: outcomeQualifiedMajorityPercentLabel,
                                        })}
                                  </p>
                                </>
                              )}
                            </div>

                            <div className="rounded-lg bg-indigo-950/20 border border-indigo-700/30 p-3">
                              <h5 className="text-xs font-semibold text-indigo-300">{t('howAutoResolutionWorks')}</h5>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                                {outcomeImmediateResolutionRound
                                  ? t('initialRoundFirstVoteRule')
                                  : t('disputeRoundThresholdRule', {
                                      quorum: outcomeResolutionQuorum,
                                      threshold: outcomeQualifiedMajorityFractionLabel,
                                      percent: outcomeQualifiedMajorityPercentLabel,
                                      yes: tAdmin('yes'),
                                      no: tAdmin('no'),
                                      invalid: tAdmin('invalid'),
                                    })}
                                {!outcomeImmediateResolutionRound && ` ${t('exactThresholdNotEnough')}`} {t('invalidVotesDiluteShares', { yes: tAdmin('yes'), no: tAdmin('no') })}
                              </p>
                            </div>

                            {outcomeMyVote && (
                              <p className="text-xs text-indigo-300">{t('yourCurrentVote')} <span className="font-semibold">{translateOutcome(outcomeMyVote)}</span></p>
                            )}

                            {outcomeVotingOpen && (
                              user ? (
                                <div className="flex flex-wrap gap-2">
                                  <Button variant="primary" size="sm" onClick={() => handleOutcomeVote(outcome.id, 'YES')} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('voteYes')}
                                  </Button>
                                  <Button variant="danger" size="sm" onClick={() => handleOutcomeVote(outcome.id, 'NO')} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('voteNo')}
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={() => handleOutcomeVote(outcome.id, 'INVALID')} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('voteInvalid')}
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-600 dark:text-gray-400">{t('loginToVoteAfterEnd')}</p>
                              )
                            )}

                            {user?.isAdmin && outcome.status === 'DISPUTED' && (
                              <div className="rounded-lg bg-yellow-900/20 border border-yellow-700/40 p-3">
                                <p className="text-xs text-yellow-300 mb-2">{t('adminOverrideTitle')}</p>
                                <div className="flex flex-wrap gap-2">
                                  <Button variant="primary" size="sm" onClick={() => handleOutcomeAdminResolve(outcome.id, 'YES')} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('resolveYes')}
                                  </Button>
                                  <Button variant="danger" size="sm" onClick={() => handleOutcomeAdminResolve(outcome.id, 'NO')} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('resolveNo')}
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={() => handleOutcomeAdminResolve(outcome.id, 'INVALID')} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('resolveInvalid')}
                                  </Button>
                                </div>
                              </div>
                            )}

                            {outcome.status === 'RESOLVED' && outcomeDisputeWindowOpen && (
                              user ? (
                                <div className="space-y-2">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('disputeProposedOutcome')}</label>
                                    <select
                                      value={outcomeDisputeOutcome[outcome.id] || 'YES'}
                                      onChange={(e) => setOutcomeDisputeOutcome((prev) => ({ ...prev, [outcome.id]: e.target.value as 'YES' | 'NO' | 'INVALID' }))}
                                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                      <option value="YES">{tAdmin('yes')}</option>
                                      <option value="NO">{tAdmin('no')}</option>
                                      <option value="INVALID">{tAdmin('invalid')}</option>
                                    </select>
                                  </div>
                                  <textarea
                                    value={outcomeDisputeReason[outcome.id] || ''}
                                    onChange={(e) => setOutcomeDisputeReason((prev) => ({ ...prev, [outcome.id]: e.target.value }))}
                                    rows={3}
                                    placeholder={t('disputeReasonPlaceholder')}
                                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                  />
                                  <Button variant="outline" size="sm" onClick={() => handleOutcomeDispute(outcome.id)} loading={outcomeResolutionLoadingId === outcome.id}>
                                    {t('fileDispute')}
                                  </Button>
                                  {outcomeDisputeWindowEndsAt && (
                                    <p className="text-xs text-gray-500 dark:text-gray-500">
                                      {t('resolvedAsDisputesOpenUntil', {
                                        outcome: translateOutcome(outcome.resolution || 'INVALID'),
                                        date: formatDateTime(outcomeDisputeWindowEndsAt.toISOString()),
                                      })}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-600 dark:text-gray-400">{t('loginToDisputeOpenWindow')}</p>
                              )
                            )}

                            {outcome.disputes.length > 0 && (
                              <div className="rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/60 p-3 text-xs">
                                <p className="text-gray-700 dark:text-gray-300">
                                  {t('recentDisputes')}: {outcome.disputes[0].reason}
                                </p>
                                <p className="text-gray-500 dark:text-gray-500 mt-1">
                                  @{outcome.disputes[0].user.username} · {formatRelativeTime(outcome.disputes[0].createdAt, locale)} · {t('proposed')} {translateOutcome(outcome.disputes[0].proposedOutcome)}
                                </p>
                              </div>
                            )}

                            <p className="text-xs text-gray-500 dark:text-gray-500">{t('totalVotesCast', { count: outcomeTotalVotes })}</p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Probability Card */}
              <div className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('currentProbability')}</h2>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-4">
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
              <div className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 sm:p-5 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">{t('priceHistoryTitle')}</h2>
                <PriceChart data={market.priceHistory} />
              </div>
            </>
          )}

          {/* Exchange Order History */}
          {((market.orderFills && market.orderFills.length > 0) || (market.userOrders && market.userOrders.length > 0)) && (
            <ExchangeHistoryPanel orderFills={market.orderFills ?? []} userOrders={market.userOrders ?? []} />
          )}

          {/* Description */}
          <div className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 sm:p-5 shadow-sm">
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
          {!isMultiMarket && (votingOpen || market.status === 'RESOLVED' || market.status === 'DISPUTED') && (
            <div className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 sm:p-5 space-y-3 sm:space-y-4 shadow-sm">
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

              <div className="grid grid-cols-3 gap-1 sm:gap-2 text-xs sm:text-sm">
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

              <div className="rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/60 p-2 sm:p-3 space-y-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-3 text-xs sm:text-sm">
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
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
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

              <div className="rounded-lg bg-indigo-950/20 border border-indigo-700/30 p-2 sm:p-3">
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
                <p className="text-xs sm:text-sm text-indigo-300">
                  {t('yourCurrentVote')} <span className="font-semibold">{myVote}</span>
                </p>
              )}

              {votingOpen && (
                user ? (
                  <div className="flex flex-wrap gap-1 sm:gap-2">
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
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{t('loginToVoteAfterEnd')}</p>
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
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-4">
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

          {/* Comments Section - Progressive Loading */}
          <MarketCommentsSection
            marketId={id}
            initialComments={market.comments}
            isPrefetched={Boolean(market)}
          />
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {!isMultiMarket && <TradePanel market={market} onTradeComplete={fetchMarket} />}

          {/* Market Stats */}
          <div className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 sm:p-5 text-xs sm:text-sm space-y-2 sm:space-y-3 shadow-sm">
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
              <span className="text-gray-900 dark:text-white">{aggregateTrades}</span>
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
    <div className="bg-white/90 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('exchangeHistoryTitle')}</h2>
        <div className="inline-flex rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden text-xs bg-gray-100 dark:bg-gray-800">
          <button
            onClick={() => setTab('fills')}
            className={`px-3 py-1.5 font-medium transition-colors ${tab === 'fills' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            {tTradePanel('recentFills', { outcome: `${tAdmin('yes')}/${tAdmin('no')}` })}
          </button>
          {userOrders.length > 0 && (
            <button
              onClick={() => setTab('orders')}
              className={`px-3 py-1.5 font-medium transition-colors ${tab === 'orders' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'}`}
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
                    <td className="py-1.5 text-right font-mono">{formatFixed(fill.shares)}</td>
                    <td className="py-1.5 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(Number(fill.price) * Number(fill.shares))}</td>
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
                      {formatPercent(Number(order.price))}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">{formatFixed(order.initialShares)} {tPortfolio('shares').toLowerCase()}</span>
                  </div>
                  <span className={`font-medium ${ORDER_STATUS_COLORS[order.status]}`}>{translateOrderStatus(order.status)}</span>
                </div>

                {/* Fill progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-gray-500 dark:text-gray-500">
                    <span>{tTradePanel('filledLabel', { filled: formatFixed(filledShares), total: formatFixed(order.initialShares) })}</span>
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
