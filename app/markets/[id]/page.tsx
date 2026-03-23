'use client'

import { useState, useEffect, useCallback } from 'react'
import { use } from 'react'
import { notFound } from 'next/navigation'
import { PriceChart } from '@/components/PriceChart'
import { TradePanel } from '@/components/TradePanel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { MIN_RESOLUTION_VOTES, formatQualifiedMajorityLabel, getQualifiedMajorityThreshold } from '@/lib/resolution'
import { formatCurrency, formatPercent, formatDateTime, getCategoryColor, timeUntil } from '@/lib/utils'
import toast from 'react-hot-toast'

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
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, refreshUser } = useAuth()
  const [market, setMarket] = useState<Market | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [resolutionActionLoading, setResolutionActionLoading] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeOutcome, setDisputeOutcome] = useState<'YES' | 'NO' | 'INVALID'>('YES')

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
        toast.success('Comment posted!')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to post comment')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleVote = async (outcome: 'YES' | 'NO' | 'INVALID') => {
    if (!user) {
      toast.error('Please log in to vote on resolution')
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
          toast.success(`Vote recorded. Market auto-resolved as ${data.majorityOutcome}.`)
          await refreshUser()
        } else {
          toast.success(`Vote recorded for ${outcome}`)
        }
        await fetchMarket()
      } else {
        toast.error(data.error || 'Vote failed')
      }
    } catch {
      toast.error('Network error')
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
        toast.success(`Market resolved as ${outcome}`)
        await refreshUser()
        await fetchMarket()
      } else {
        toast.error(data.error || 'Resolution failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setResolutionActionLoading(false)
    }
  }

  const handleDispute = async () => {
    if (!user) {
      toast.error('Please log in to file a dispute')
      return
    }
    if (disputeReason.trim().length < 20) {
      toast.error('Dispute reason must be at least 20 characters')
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
        toast.success(data.message || 'Dispute filed successfully')
        setDisputeReason('')
        await fetchMarket()
      } else {
        toast.error(data.error || 'Dispute failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setResolutionActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-800 rounded w-3/4" />
        <div className="h-4 bg-gray-800 rounded w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 h-96 bg-gray-800 rounded-xl" />
          <div className="h-64 bg-gray-800 rounded-xl" />
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
  const votesNeededForQuorum = Math.max(0, MIN_RESOLUTION_VOTES - totalVoteCount)
  const quorumReached = totalVoteCount >= MIN_RESOLUTION_VOTES
  const qualifiedMajorityThreshold = getQualifiedMajorityThreshold(market.disputeCount)
  const qualifiedMajorityFractionLabel = formatQualifiedMajorityLabel(market.disputeCount)
  const nextQualifiedMajorityThreshold = getQualifiedMajorityThreshold(market.disputeCount + 1)
  const nextQualifiedMajorityFractionLabel = formatQualifiedMajorityLabel(market.disputeCount + 1)
  const currentDisputeRoundLabel = market.disputeCount === 0
    ? 'Initial resolution round'
    : `Current round: ${getOrdinalLabel(market.disputeCount)} dispute`
  const nextDisputeRoundLabel = `Next round: ${getOrdinalLabel(market.disputeCount + 1)} dispute`
  const qualifiedThresholdCount = totalVoteCount * qualifiedMajorityThreshold
  const qualifiedMajorityPercentLabel = (qualifiedMajorityThreshold * 100).toFixed(1)
  const nextQualifiedMajorityPercentLabel = (nextQualifiedMajorityThreshold * 100).toFixed(1)
  const leadingOutcome = voteCounts.YES === voteCounts.NO
    ? null
    : voteCounts.YES > voteCounts.NO
    ? 'YES'
    : 'NO'
  const leadingVoteCount = leadingOutcome ? voteCounts[leadingOutcome] : 0
  const validMajorityReached = Boolean(quorumReached && leadingOutcome && leadingVoteCount >= qualifiedThresholdCount)
  const invalidMajorityReached = quorumReached && voteCounts.INVALID >= qualifiedThresholdCount
  // Progress as share of ALL votes so INVALID votes visibly dilute YES/NO share
  const leadingProgressPercent = totalVoteCount > 0 ? (leadingVoteCount / totalVoteCount) * 100 : 0
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
      title: `@${vote.user.username} voted ${vote.outcome}`,
      description: 'Resolution vote recorded.',
    })),
    ...(market.resolution && market.resolutionTime
      ? [{
          id: `resolution-${market.resolutionTime}`,
          createdAt: market.resolutionTime,
          tone: 'indigo',
          title: `Market resolved as ${market.resolution}`,
          description: 'The market outcome was finalized and settlements were processed.',
        }]
      : []),
    ...market.disputes.map((dispute) => ({
      id: `dispute-${dispute.id}`,
      createdAt: dispute.createdAt,
      tone: 'yellow',
      title: `@${dispute.user.username} disputed with ${dispute.proposedOutcome}`,
      description: dispute.reason,
    })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${getCategoryColor(market.category)}`}>
            {market.category}
          </span>
          {market.status !== 'OPEN' && (
            <Badge variant={market.status === 'RESOLVED' ? 'info' : market.status === 'INVALID' ? 'danger' : 'warning'}>
              {market.status} {market.resolution ? `(${market.resolution})` : ''}
            </Badge>
          )}
          {market.tags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">#{tag}</span>
          ))}
        </div>
        <h1 className="text-2xl font-bold text-white">{market.title}</h1>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
          <span>By <span className="text-gray-400">@{market.creator.username}</span></span>
          <span>Ends {isExpired ? 'ended' : ''} {formatDateTime(market.endDate)}</span>
          <span>{market._count.trades} trades</span>
          <span>Vol: {formatCurrency(market.totalVolume)}</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Probability Card */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">Current Probability</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-green-900/30 border border-green-700/30 rounded-lg p-3 text-center">
                <div className="text-3xl font-bold text-green-400">{formatPercent(market.probabilities.yes)}</div>
                <div className="text-sm text-green-600 mt-1">YES</div>
              </div>
              <div className="bg-red-900/30 border border-red-700/30 rounded-lg p-3 text-center">
                <div className="text-3xl font-bold text-red-400">{formatPercent(market.probabilities.no)}</div>
                <div className="text-sm text-red-600 mt-1">NO</div>
              </div>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                style={{ width: `${market.probabilities.yes * 100}%` }}
              />
            </div>
          </div>

          {/* Price Chart */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <h2 className="text-base font-semibold text-white mb-3">Price History</h2>
            <PriceChart data={market.priceHistory} />
          </div>

          {/* Description */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <h2 className="text-base font-semibold text-white mb-2">About this Market</h2>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{market.description}</p>
            {market.resolutionSource && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <span className="text-xs text-gray-500">Resolution source: </span>
                <a href={market.resolutionSource} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:underline break-all">
                  {market.resolutionSource}
                </a>
              </div>
            )}
          </div>

          {/* Resolution Center */}
          {(votingOpen || market.status === 'RESOLVED' || market.status === 'DISPUTED') && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">Resolution Center</h2>
                {votingOpen && (
                  <p className="text-sm text-gray-400 mt-1">
                    Trading is closed. Community voting is now open to resolve this market.
                  </p>
                )}
                {market.status === 'RESOLVED' && disputeWindowOpen && disputeWindowEndsAt && (
                  <p className="text-sm text-gray-400 mt-1">
                    Resolved as {market.resolution}. Disputes remain open until {formatDateTime(disputeWindowEndsAt.toISOString())}.
                  </p>
                )}
                {market.status === 'DISPUTED' && (
                  <p className="text-sm text-yellow-400 mt-1">
                    This market is under dispute ({getOrdinalLabel(market.disputeCount)} dispute round). Community re-voting is open — a qualified majority of {qualifiedMajorityFractionLabel} will re-resolve it.
                    {user?.isAdmin && ' Admin override is available below.'}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-green-900/20 border border-green-700/30 p-3 text-center">
                  <div className="text-green-400 font-semibold">YES</div>
                  <div className="text-white text-lg font-bold">{voteCounts.YES}</div>
                </div>
                <div className="rounded-lg bg-red-900/20 border border-red-700/30 p-3 text-center">
                  <div className="text-red-400 font-semibold">NO</div>
                  <div className="text-white text-lg font-bold">{voteCounts.NO}</div>
                </div>
                <div className="rounded-lg bg-gray-700/40 border border-gray-600/40 p-3 text-center">
                  <div className="text-gray-300 font-semibold">INVALID</div>
                  <div className="text-white text-lg font-bold">{voteCounts.INVALID}</div>
                </div>
              </div>

              <div className="rounded-lg bg-gray-900/60 border border-gray-700/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-400">Leading outcome</span>
                  <span className="text-white font-medium">
                    {invalidMajorityReached
                      ? `INVALID has qualified majority (${voteCounts.INVALID}/${totalVoteCount})`
                      : leadingOutcome
                      ? `${leadingOutcome} leads — ${leadingVoteCount}/${totalVoteCount} votes (${totalVoteCount > 0 ? Math.round(leadingVoteCount / totalVoteCount * 100) : 0}%)`
                      : totalVoteCount > 0
                      ? 'No outcome has a qualified majority yet'
                      : 'No votes yet'}
                  </span>
                </div>
                {totalVoteCount > 0 && (
                  <>
                    {/* Stacked progress bar: YES | NO | INVALID */}
                    <div className="h-3 bg-gray-700 rounded-full overflow-hidden flex">
                      <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${totalVoteCount > 0 ? (voteCounts.YES / totalVoteCount) * 100 : 0}%` }} />
                      <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${totalVoteCount > 0 ? (voteCounts.NO / totalVoteCount) * 100 : 0}%` }} />
                      <div className="h-full bg-gray-400 transition-all duration-500" style={{ width: `${invalidProgressPercent}%` }} />
                    </div>
                    {/* Threshold marker */}
                    <div className="relative h-1">
                      <div
                        className="absolute top-0 w-0.5 h-3 bg-yellow-400 -translate-y-1"
                        style={{ left: `${qualifiedMajorityThreshold * 100}%` }}
                        title={`Qualified majority threshold (${qualifiedMajorityPercentLabel}%)`}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {!quorumReached
                        ? `Quorum not reached — ${votesNeededForQuorum} more vote${votesNeededForQuorum === 1 ? '' : 's'} needed.`
                        : validMajorityReached
                        ? `${leadingOutcome} has a qualified majority and will auto-resolve.`
                        : invalidMajorityReached
                        ? 'INVALID has a qualified majority and will auto-resolve.'
                        : `No outcome has reached the ${qualifiedMajorityFractionLabel} (${qualifiedMajorityPercentLabel}%) threshold yet.`}
                    </p>
                  </>
                )}
                <p className="text-xs text-gray-500">Total votes cast: {totalVoteCount}</p>
              </div>

              <div className="rounded-lg bg-indigo-950/20 border border-indigo-700/30 p-3">
                <h3 className="text-sm font-semibold text-indigo-300">How Auto-Resolution Works</h3>
                <p className="text-sm text-gray-400 mt-2">
                  Auto-resolution requires two conditions to both be true: a <strong className="text-indigo-200">minimum quorum</strong> of {MIN_RESOLUTION_VOTES} total votes,
                  and a <strong className="text-indigo-200">qualified majority</strong> of {qualifiedMajorityFractionLabel} ({qualifiedMajorityPercentLabel}%) of <em>all</em> votes cast
                  (YES, NO, and INVALID combined) in favour of a single outcome.
                  {market.disputeCount > 0 ? ` This market is on dispute round ${market.disputeCount}, so the required supermajority has escalated to ${qualifiedMajorityFractionLabel}.` : ''}
                  INVALID votes count toward the total and dilute YES/NO shares, so a contentious market needs even more agreement to resolve.
                </p>
              </div>

              {myVote && (
                <p className="text-sm text-indigo-300">
                  Your current vote: <span className="font-semibold">{myVote}</span>
                </p>
              )}

              {votingOpen && (
                user ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={() => handleVote('YES')} loading={resolutionActionLoading}>
                      Vote YES
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleVote('NO')} loading={resolutionActionLoading}>
                      Vote NO
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleVote('INVALID')} loading={resolutionActionLoading}>
                      Vote INVALID
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Log in to vote on the outcome once a market has ended.</p>
                )
              )}

              {user?.isAdmin && market.status === 'DISPUTED' && (
                <div className="border-t border-yellow-700/40 pt-4 space-y-3">
                  <div className="rounded-lg bg-yellow-900/20 border border-yellow-700/40 p-3">
                    <h3 className="text-sm font-semibold text-yellow-300 mb-1">Admin Override</h3>
                    <p className="text-xs text-gray-400 mb-3">
                      Force-resolve this disputed market with a specific outcome, bypassing community voting.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" size="sm" onClick={() => handleAdminResolve('YES')} loading={resolutionActionLoading}>
                        Resolve YES
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleAdminResolve('NO')} loading={resolutionActionLoading}>
                        Resolve NO
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => handleAdminResolve('INVALID')} loading={resolutionActionLoading}>
                        Resolve INVALID
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {market.status === 'RESOLVED' && disputeWindowOpen && (
                user ? (
                  <div className="space-y-3 border-t border-gray-700 pt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Dispute Proposed Outcome</label>
                      <select
                        value={disputeOutcome}
                        onChange={(e) => setDisputeOutcome(e.target.value as 'YES' | 'NO' | 'INVALID')}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="YES">YES</option>
                        <option value="NO">NO</option>
                        <option value="INVALID">INVALID</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Dispute Reason</label>
                      <textarea
                        value={disputeReason}
                        onChange={(e) => setDisputeReason(e.target.value)}
                        rows={4}
                        placeholder="Explain why the current resolution is incorrect and provide supporting context..."
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      />
                      <p className="text-xs text-gray-500 mt-1">Minimum 20 characters. Be specific about the evidence or criteria.</p>
                      <div className="mt-2 rounded-md bg-yellow-950/30 border border-yellow-700/30 p-3 space-y-1">
                        <p className="text-xs text-yellow-100">
                          {currentDisputeRoundLabel}
                        </p>
                        <p className="text-xs text-yellow-200">
                          Current qualified majority: {qualifiedMajorityFractionLabel} ({qualifiedMajorityPercentLabel}%)
                        </p>
                        <p className="text-xs text-yellow-100 pt-1">
                          {nextDisputeRoundLabel}
                        </p>
                        <p className="text-xs text-yellow-300">
                          After filing this dispute: {nextQualifiedMajorityFractionLabel} ({nextQualifiedMajorityPercentLabel}%)
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDispute} loading={resolutionActionLoading}>
                      File Dispute
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 border-t border-gray-700 pt-4">
                    Log in to file a dispute while the dispute window is open.
                  </p>
                )
              )}

              {market.disputes.length > 0 && (
                <div className="border-t border-gray-700 pt-4 space-y-2">
                  <h3 className="text-sm font-semibold text-white">Recent Disputes</h3>
                  {market.disputes.map((dispute) => (
                    <div key={dispute.id} className="rounded-lg bg-gray-900/60 border border-gray-700/60 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-300">Proposed: <span className="font-semibold text-white">{dispute.proposedOutcome}</span></span>
                        <span className="text-xs text-gray-500">{timeUntil(dispute.createdAt)}</span>
                      </div>
                      <p className="text-gray-400 mt-2">{dispute.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {resolutionActivity.length > 0 && (
                <div className="border-t border-gray-700 pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-white">Resolution Activity</h3>
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
                          <div className="mt-1 h-full w-px bg-gray-700 last:hidden" />
                        </div>
                        <div className="flex-1 rounded-lg bg-gray-900/60 border border-gray-700/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium text-white">{item.title}</p>
                            <div className="text-right text-xs text-gray-500 shrink-0">
                              <div>{timeUntil(item.createdAt)}</div>
                              <div>{formatDateTime(item.createdAt)}</div>
                            </div>
                          </div>
                          <p className="text-sm text-gray-400 mt-1">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comments */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <h2 className="text-base font-semibold text-white mb-4">
              Discussion ({market.comments.length})
            </h2>

            {user && (
              <div className="flex gap-2 mb-4">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleComment() }}
                  placeholder="Share your thoughts..."
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Button size="sm" onClick={handleComment} loading={submittingComment}>Post</Button>
              </div>
            )}

            {market.comments.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No comments yet. Be the first!</p>
            ) : (
              <div className="space-y-3">
                {market.comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {c.user.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-white">@{c.user.username}</span>
                        <span className="text-xs text-gray-500">{timeUntil(c.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-300 mt-0.5">{c.content}</p>
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
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-sm space-y-3">
            <h3 className="font-semibold text-white">Market Stats</h3>
            <div className="flex justify-between text-gray-400">
              <span>Total Volume</span>
              <span className="text-white">{formatCurrency(market.totalVolume)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Total Trades</span>
              <span className="text-white">{market._count.trades}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>End Date</span>
              <span className="text-white">{formatDateTime(market.endDate)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Status</span>
              <span className="text-white">{market.status}</span>
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
