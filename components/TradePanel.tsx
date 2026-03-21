'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency, formatPercent } from '@/lib/utils'

interface Market {
  id: string
  status: string
  yesShares: number
  noShares: number
  liquidityParam: number
  probabilities: { yes: number; no: number }
}

interface TradePanelProps {
  market: Market
  onTradeComplete: () => void
}

export function TradePanel({ market, onTradeComplete }: TradePanelProps) {
  const { user, refreshUser } = useAuth()
  const [selectedOutcome, setSelectedOutcome] = useState<'YES' | 'NO'>('YES')
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY')
  const [shares, setShares] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preview, setPreview] = useState<{ cost: number; price: number } | null>(null)

  const currentPrice = selectedOutcome === 'YES' ? market.probabilities.yes : market.probabilities.no

  const handlePreview = async () => {
    const sharesNum = parseFloat(shares)
    if (!sharesNum || sharesNum <= 0) {
      toast.error('Enter a valid share amount')
      return
    }
    // Simple cost estimate
    const cost = sharesNum * currentPrice
    setPreview({ cost, price: currentPrice })
    setConfirmOpen(true)
  }

  const handleTrade = async () => {
    if (!user) { toast.error('Please log in'); return }
    const sharesNum = parseFloat(shares)
    if (!sharesNum || sharesNum <= 0) { toast.error('Enter a valid share amount'); return }

    setLoading(true)
    try {
      const res = await fetch(`/api/markets/${market.id}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: selectedOutcome, type: tradeType, shares: sharesNum }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${tradeType === 'BUY' ? 'Bought' : 'Sold'} ${sharesNum} ${selectedOutcome} shares!`)
        setShares('')
        setConfirmOpen(false)
        await refreshUser()
        onTradeComplete()
      } else {
        toast.error(data.error || 'Trade failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (market.status !== 'OPEN') {
    return (
      <div className="bg-gray-800/50 rounded-xl p-4 text-center text-gray-400">
        This market is {market.status.toLowerCase()} and no longer accepting trades.
      </div>
    )
  }

  if (!user) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-4 text-center">
        <p className="text-gray-400 mb-3">Sign in to trade on this market</p>
        <a href="/auth/login" className="text-indigo-400 hover:text-indigo-300 font-medium">Log in →</a>
      </div>
    )
  }

  return (
    <>
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-4">
        <h3 className="font-semibold text-white">Place Trade</h3>

        {/* Buy/Sell Toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          <button
            onClick={() => setTradeType('BUY')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tradeType === 'BUY' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setTradeType('SELL')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tradeType === 'SELL' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sell
          </button>
        </div>

        {/* YES/NO Selection */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSelectedOutcome('YES')}
            className={`py-3 rounded-lg font-semibold text-sm transition-all ${
              selectedOutcome === 'YES'
                ? 'bg-green-600 text-white ring-2 ring-green-500'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            YES <span className="block text-xs font-normal">{formatPercent(market.probabilities.yes)}</span>
          </button>
          <button
            onClick={() => setSelectedOutcome('NO')}
            className={`py-3 rounded-lg font-semibold text-sm transition-all ${
              selectedOutcome === 'NO'
                ? 'bg-red-600 text-white ring-2 ring-red-500'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            NO <span className="block text-xs font-normal">{formatPercent(market.probabilities.no)}</span>
          </button>
        </div>

        {/* Shares Input */}
        <div>
          <Input
            label="Number of Shares"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            hint={`Balance: ${formatCurrency(user.balance)}`}
          />
        </div>

        {/* Est. Cost */}
        {shares && parseFloat(shares) > 0 && (
          <div className="bg-gray-700/50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-400">
              <span>Est. Cost</span>
              <span className="text-white">{formatCurrency(parseFloat(shares) * currentPrice)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Avg. Price</span>
              <span className="text-white">{formatPercent(currentPrice)}</span>
            </div>
          </div>
        )}

        <Button
          className="w-full"
          onClick={handlePreview}
          disabled={!shares || parseFloat(shares) <= 0}
          variant={selectedOutcome === 'YES' ? 'primary' : 'danger'}
        >
          {tradeType} {selectedOutcome} Shares
        </Button>
      </div>

      {/* Confirmation Modal */}
      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm Trade">
        <div className="space-y-4">
          <div className="bg-gray-700/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Action</span>
              <span className="text-white font-medium">{tradeType} {selectedOutcome}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Shares</span>
              <span className="text-white font-medium">{shares}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Price per Share</span>
              <span className="text-white font-medium">{preview && formatPercent(preview.price)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-600 pt-2">
              <span className="text-gray-400">Est. {tradeType === 'BUY' ? 'Cost' : 'Proceeds'}</span>
              <span className="text-white font-bold">{preview && formatCurrency(preview.cost)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            ⚠️ Prices may change slightly due to LMSR market mechanics.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              className="flex-1"
              onClick={handleTrade}
              loading={loading}
              variant={selectedOutcome === 'YES' ? 'primary' : 'danger'}
            >
              Confirm {tradeType}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
