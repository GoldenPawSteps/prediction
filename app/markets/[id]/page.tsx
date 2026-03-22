'use client'

import { useState, useEffect, useCallback } from 'react'
import { use } from 'react'
import { notFound } from 'next/navigation'
import { PriceChart } from '@/components/PriceChart'
import { TradePanel } from '@/components/TradePanel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
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
  endDate: string
  totalVolume: number
  yesShares: number
  noShares: number
  liquidityParam: number
  probabilities: { yes: number; no: number }
  priceHistory: Array<{ timestamp: string; yesPrice: number; noPrice: number }>
  comments: Array<{ id: string; content: string; createdAt: string; user: { id: string; username: string; avatar: string | null } }>
  creator: { id: string; username: string; avatar: string | null }
  _count: { trades: number }
  tags: string[]
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, refreshUser } = useAuth()
  const [market, setMarket] = useState<Market | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [resolving, setResolving] = useState(false)

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

  const handleResolve = async (outcome: 'YES' | 'NO' | 'INVALID') => {
    if (!confirm(`Resolve market as ${outcome}?`)) return
    setResolving(true)
    try {
      const res = await fetch(`/api/markets/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })
      const data = await res.json()

      if (res.ok) {
        const refunded = data?.settlement?.refundedToCreator ?? 0
        if (refunded > 0) {
          toast.success(`Market resolved as ${outcome}. Returned ${formatCurrency(refunded)} to creator.`)
        } else {
          toast.success(`Market resolved as ${outcome}`)
        }
        await refreshUser()
        fetchMarket()
      } else {
        toast.error(data.error || 'Resolution failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setResolving(false)
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

          {/* Admin Panel */}
          {user?.isAdmin && market.status === 'OPEN' && (
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4">
              <h2 className="text-base font-semibold text-yellow-400 mb-3">Admin: Resolve Market</h2>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => handleResolve('YES')} loading={resolving}>
                  Resolve YES ✓
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleResolve('NO')} loading={resolving}>
                  Resolve NO ✗
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleResolve('INVALID')} loading={resolving}>
                  Mark Invalid
                </Button>
              </div>
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
