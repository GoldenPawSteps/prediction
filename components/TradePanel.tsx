'use client'

import { useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import { formatCurrency, formatPercent, timeUntil } from '@/lib/utils'

type OrderSide = 'BID' | 'ASK'
type OrderOutcome = 'YES' | 'NO'
type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED'
type OrderType = 'GTC' | 'GTD' | 'FOK' | 'FAK'

interface MarketOrder {
  id: string
  userId: string
  outcome: OrderOutcome
  side: OrderSide
  status: OrderStatus
  orderType?: string
  price: number
  initialShares: number
  remainingShares: number
  filledShares?: number
  expiresAt?: string | null
  createdAt: string
  updatedAt?: string
  user?: { id: string; username: string; avatar: string | null }
}

interface MarketOrderFill {
  id: string
  outcome: OrderOutcome
  price: number
  shares: number
  createdAt: string
  makerUser: { id: string; username: string; avatar: string | null }
  takerUser: { id: string; username: string; avatar: string | null }
}

interface Market {
  id: string
  status: string
  endDate: string
  yesShares: number
  noShares: number
  liquidityParam: number
  probabilities: { yes: number; no: number }
  orders?: MarketOrder[]
  userOrders?: MarketOrder[]
  orderFills?: MarketOrderFill[]
}

interface TradePanelProps {
  market: Market
  onTradeComplete: () => void
}

function getLocalDateTimeInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function readApiPayload(res: Response): Promise<{ error?: string; [key: string]: unknown }> {
  const contentType = res.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      return (await res.json()) as { error?: string; [key: string]: unknown }
    } catch {
      return { error: `Invalid JSON response from server (${res.status})` }
    }
  }

  const text = await res.text()
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120)
  return {
    error: snippet
      ? `Unexpected server response (${res.status}): ${snippet}`
      : `Unexpected server response (${res.status})`,
  }
}

export function TradePanel({ market, onTradeComplete }: TradePanelProps) {
  const t = useT('tradePanel')
  const tCommon = useT('common')
  const { user, refreshUser } = useAuth()
  const [mode, setMode] = useState<'AMM' | 'EXCHANGE'>('AMM')
  const [selectedOutcome, setSelectedOutcome] = useState<'YES' | 'NO'>('YES')
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY')
  const [shares, setShares] = useState('')
  const [orderSide, setOrderSide] = useState<OrderSide>('BID')
  const [orderType, setOrderType] = useState<OrderType>('GTC')
  const [orderPrice, setOrderPrice] = useState('0.50')
  const [orderShares, setOrderShares] = useState('')
  const [gtdExpiresAt, setGtdExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preview, setPreview] = useState<{ cost: number; price: number } | null>(null)
  const isExpired = new Date(market.endDate) <= new Date()

  const currentPrice = selectedOutcome === 'YES' ? market.probabilities.yes : market.probabilities.no
  const openOrders = (market.orders ?? []).filter(
    (order) => (order.status === 'OPEN' || order.status === 'PARTIAL') && order.remainingShares > 0
  )
  const selectedOutcomeOrders = openOrders.filter((order) => order.outcome === selectedOutcome)
  const bids = selectedOutcomeOrders
    .filter((order) => order.side === 'BID')
    .sort((a, b) => b.price - a.price || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const asks = selectedOutcomeOrders
    .filter((order) => order.side === 'ASK')
    .sort((a, b) => a.price - b.price || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const myOrders = user ? openOrders.filter((order) => order.userId === user.id) : []
  const myOrderHistory = (market.userOrders ?? []).slice(0, 8)
  const recentFills = (market.orderFills ?? []).filter((fill) => fill.outcome === selectedOutcome)
  const bestBid = bids[0]?.price ?? null
  const bestAsk = asks[0]?.price ?? null

  const handlePreview = async () => {
    const sharesNum = parseFloat(shares)
    if (!sharesNum || sharesNum <= 0) {
      toast.error(t('errorInvalidShares'))
      return
    }
    // Approximate cost: actual LMSR cost may differ slightly due to market mechanics
    const cost = sharesNum * currentPrice
    setPreview({ cost, price: currentPrice })
    setConfirmOpen(true)
  }

  const handleTrade = async () => {
    if (!user) { toast.error(t('errorPleaseLogin')); return }
    const sharesNum = parseFloat(shares)
    if (!sharesNum || sharesNum <= 0) { toast.error(t('errorInvalidShares')); return }

    setLoading(true)
    try {
      const res = await fetch(`/api/markets/${market.id}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: selectedOutcome, type: tradeType, shares: sharesNum }),
      })
      const data = await readApiPayload(res)
      if (res.ok) {
        toast.success(t('toastTradeSuccess', {
          action: tradeType === 'BUY' ? t('buy') : t('sell'),
          shares: sharesNum,
          outcome: selectedOutcome,
        }))
        setShares('')
        setConfirmOpen(false)
        await refreshUser()
        onTradeComplete()
      } else {
        toast.error(data.error || t('errorTradeFailed'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorNetwork'))
    } finally {
      setLoading(false)
    }
  }

  const handlePlaceOrder = async () => {
    if (!user) {
      toast.error(t('errorPleaseLogin'))
      return
    }

    const price = parseFloat(orderPrice)
    const quantity = parseFloat(orderShares)

    if (!price || price <= 0 || price >= 1) {
      toast.error(t('errorPriceRange'))
      return
    }
    if (!quantity || quantity <= 0) {
      toast.error(t('errorInvalidShares'))
      return
    }
    if (orderType === 'GTD') {
      if (!gtdExpiresAt) {
        toast.error(t('errorChooseGtd'))
        return
      }

      const expiry = new Date(gtdExpiresAt)
      if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
        toast.error(t('errorGtdFuture'))
        return
      }
    }

    setOrderLoading(true)
    try {
      const res = await fetch(`/api/markets/${market.id}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: selectedOutcome,
          side: orderSide,
          orderType,
          price,
          shares: quantity,
          ...(orderType === 'GTD' ? { expiresAt: new Date(gtdExpiresAt).toISOString() } : {}),
        }),
      })
      const data = await readApiPayload(res)
      if (res.ok) {
        const filled = Number(data?.filledShares ?? 0)
        toast.success(
          filled > 0
            ? t('toastOrderPlacedMatched', { filled: filled.toFixed(2) })
            : t('toastOrderPlaced')
        )
        setOrderShares('')
        if (orderType === 'GTD') setGtdExpiresAt('')
        await refreshUser()
        onTradeComplete()
      } else {
        toast.error(data.error || t('errorPlaceOrderFailed'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorNetwork'))
    } finally {
      setOrderLoading(false)
    }
  }

  const handleCancelOrder = async (orderId: string) => {
    if (!user) return

    setOrderLoading(true)
    try {
      const res = await fetch(`/api/markets/${market.id}/order`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const data = await readApiPayload(res)
      if (res.ok) {
        toast.success(t('toastOrderCancelled'))
        await refreshUser()
        onTradeComplete()
      } else {
        toast.error(data.error || t('errorCancelOrderFailed'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorNetwork'))
    } finally {
      setOrderLoading(false)
    }
  }

  if (market.status !== 'OPEN' || isExpired) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800/50 rounded-xl p-4 text-center text-gray-600 dark:text-gray-400">
        {isExpired
          ? t('marketExpired')
          : t('marketClosed', { status: market.status.toLowerCase() })}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800/50 rounded-xl p-4 text-center">
        <p className="text-gray-600 dark:text-gray-400 mb-3">{t('loginToTrade')}</p>
        <Link href="/auth/login" className="text-indigo-400 hover:text-indigo-300 font-medium">{t('loginLink')}</Link>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-white">{t('placeTrade')}</h3>
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setMode('AMM')}
              className={`px-3 py-1.5 text-xs font-medium ${mode === 'AMM' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
            >
              {t('amm')}
            </button>
            <button
              onClick={() => setMode('EXCHANGE')}
              className={`px-3 py-1.5 text-xs font-medium ${mode === 'EXCHANGE' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
            >
              {t('exchange')}
            </button>
          </div>
        </div>

        {mode === 'AMM' ? (
          <>
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
              <button
                onClick={() => setTradeType('BUY')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  tradeType === 'BUY' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {t('buy')}
              </button>
              <button
                onClick={() => setTradeType('SELL')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  tradeType === 'SELL' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {t('sell')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelectedOutcome('YES')}
                className={`py-3 rounded-lg font-semibold text-sm transition-all ${
                  selectedOutcome === 'YES'
                    ? 'bg-green-600 text-white ring-2 ring-green-500'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                YES <span className="block text-xs font-normal">{formatPercent(market.probabilities.yes)}</span>
              </button>
              <button
                onClick={() => setSelectedOutcome('NO')}
                className={`py-3 rounded-lg font-semibold text-sm transition-all ${
                  selectedOutcome === 'NO'
                    ? 'bg-red-600 text-white ring-2 ring-red-500'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                NO <span className="block text-xs font-normal">{formatPercent(market.probabilities.no)}</span>
              </button>
            </div>

            <div>
              <Input
                label={t('sharesLabel')}
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                hint={t('balanceHint', { amount: formatCurrency(user.balance) })}
              />
            </div>

            {shares && parseFloat(shares) > 0 && (
              <div className="bg-gray-100/50 dark:bg-gray-700/50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>{t('estCost')}</span>
                  <span className="text-gray-900 dark:text-white">{formatCurrency(parseFloat(shares) * currentPrice)}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>{t('avgPrice')}</span>
                  <span className="text-gray-900 dark:text-white">{formatPercent(currentPrice)}</span>
                </div>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handlePreview}
              disabled={!shares || parseFloat(shares) <= 0}
              variant={selectedOutcome === 'YES' ? 'primary' : 'danger'}
            >
              {tradeType} {selectedOutcome} {t('shares')}
            </Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelectedOutcome('YES')}
                className={`py-2 rounded-lg font-semibold text-sm transition-all ${
                  selectedOutcome === 'YES'
                    ? 'bg-green-600 text-white ring-2 ring-green-500'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                YES
              </button>
              <button
                onClick={() => setSelectedOutcome('NO')}
                className={`py-2 rounded-lg font-semibold text-sm transition-all ${
                  selectedOutcome === 'NO'
                    ? 'bg-red-600 text-white ring-2 ring-red-500'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                NO
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                <div className="text-gray-500">{t('bestBid')}</div>
                <div className="text-green-400 font-semibold">{bestBid !== null ? formatPercent(bestBid) : '-'}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                <div className="text-gray-500">{t('bestAsk')}</div>
                <div className="text-red-400 font-semibold">{bestAsk !== null ? formatPercent(bestAsk) : '-'}</div>
              </div>
            </div>

            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
              <button
                onClick={() => setOrderSide('BID')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  orderSide === 'BID' ? 'bg-green-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {t('bidBuy')}
              </button>
              <button
                onClick={() => setOrderSide('ASK')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  orderSide === 'ASK' ? 'bg-red-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {t('askSell')}
              </button>
            </div>

            {/* Order type selector */}
            <div className="space-y-1">
              <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t('orderType')}</div>
              <div className="grid grid-cols-4 gap-1">
                {(['GTC', 'GTD', 'FOK', 'FAK'] as OrderType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    className={`py-1.5 rounded text-xs font-medium transition-colors ${
                      orderType === t ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="text-xs text-gray-500">
                {orderType === 'GTC' && t('gtcHint')}
                {orderType === 'GTD' && t('gtdHint')}
                {orderType === 'FOK' && t('fokHint')}
                {orderType === 'FAK' && t('fakHint')}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                label={t('pricePerShare')}
                type="number"
                min="0.01"
                max="0.99"
                step="0.01"
                placeholder="0.50"
                value={orderPrice}
                onChange={(e) => setOrderPrice(e.target.value)}
              />
              <Input
                label={t('shares')}
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={orderShares}
                onChange={(e) => setOrderShares(e.target.value)}
                hint={orderSide === 'BID' ? t('reserveHint', { amount: formatCurrency((parseFloat(orderPrice) || 0) * (parseFloat(orderShares) || 0)) }) : undefined}
              />
            </div>

            {orderType === 'GTD' && (
              <Input
                label={t('goodTillLabel')}
                type="datetime-local"
                value={gtdExpiresAt}
                onChange={(e) => setGtdExpiresAt(e.target.value)}
                min={getLocalDateTimeInputValue(new Date(Date.now() + 60_000))}
              />
            )}

            <Button
              className="w-full"
              loading={orderLoading}
              onClick={handlePlaceOrder}
              disabled={!orderShares || !orderPrice || (orderType === 'GTD' && !gtdExpiresAt)}
              variant={orderSide === 'BID' ? 'primary' : 'danger'}
            >
              {orderType} {orderSide} {selectedOutcome}
            </Button>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 space-y-1 max-h-36 overflow-y-auto">
                <div className="text-green-400 font-semibold mb-1">{t('bids')}</div>
                {bids.length === 0 ? <div className="text-gray-500">{t('noBids')}</div> : bids.slice(0, 8).map((order) => (
                  <div key={order.id} className="flex items-start justify-between gap-2 text-gray-700 dark:text-gray-300">
                    <div className="flex flex-col">
                      <span>{order.remainingShares.toFixed(2)}</span>
                      {order.orderType === 'GTD' && order.expiresAt && (
                        <span className="text-[10px] text-indigo-300" title={new Date(order.expiresAt).toLocaleString()}>
                          {t('gtdLabel', { time: timeUntil(order.expiresAt) })}
                        </span>
                      )}
                    </div>
                    <span>{formatPercent(order.price)}</span>
                  </div>
                ))}
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 space-y-1 max-h-36 overflow-y-auto">
                <div className="text-red-400 font-semibold mb-1">{t('asks')}</div>
                {asks.length === 0 ? <div className="text-gray-500">{t('noAsks')}</div> : asks.slice(0, 8).map((order) => (
                  <div key={order.id} className="flex items-start justify-between gap-2 text-gray-700 dark:text-gray-300">
                    <div className="flex flex-col">
                      <span>{order.remainingShares.toFixed(2)}</span>
                      {order.orderType === 'GTD' && order.expiresAt && (
                        <span className="text-[10px] text-indigo-300" title={new Date(order.expiresAt).toLocaleString()}>
                          {t('gtdLabel', { time: timeUntil(order.expiresAt) })}
                        </span>
                      )}
                    </div>
                    <span>{formatPercent(order.price)}</span>
                  </div>
                ))}
              </div>
            </div>

            {myOrders.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 space-y-2">
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('openOrders')}</div>
                {myOrders.slice(0, 6).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-700 dark:text-gray-300">
                      {order.side} {order.outcome} {order.remainingShares.toFixed(2)}/{order.initialShares.toFixed(2)} @ {formatPercent(order.price)}
                      {order.orderType === 'GTD' && order.expiresAt && (
                        <span className="text-indigo-300"> · {t('gtdLabel', { time: timeUntil(order.expiresAt) })}</span>
                      )}
                    </span>
                    <button
                      className="text-red-400 hover:text-red-300"
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={orderLoading}
                    >
                      {t('cancelBtn')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {myOrderHistory.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 space-y-2">
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('recentOrders')}</div>
                {myOrderHistory.map((order) => {
                  const filledShares = Math.max(0, Number(order.filledShares ?? 0))
                  const statusTone = order.status === 'FILLED'
                    ? 'text-green-400'
                    : order.status === 'CANCELLED'
                    ? 'text-gray-500'
                    : order.status === 'PARTIAL'
                    ? 'text-yellow-400'
                    : 'text-blue-400'

                  return (
                    <div key={`history-${order.id}`} className="rounded-md bg-gray-100 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1">
                          {order.side} {order.outcome}{' '}
                          {order.orderType && order.orderType !== 'GTC' && (
                            <span className="bg-gray-700 text-gray-300 px-1 rounded text-[10px]">{order.orderType}</span>
                          )}
                          {' '}{order.initialShares.toFixed(2)} @ {formatPercent(order.price)}
                        </span>
                        <span className={statusTone}>{order.status}</span>
                      </div>
                      <div className="mt-1 text-gray-500">
                        {t('filledLabel', { filled: filledShares.toFixed(2), total: order.initialShares.toFixed(2) })}
                      </div>
                      {order.orderType === 'GTD' && order.expiresAt && (
                        <div className="mt-1 text-gray-500">
                          {t('expiresLabel', { date: new Date(order.expiresAt).toLocaleString() })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

              <div className="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 space-y-2">
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('recentFills', { outcome: selectedOutcome })}</div>
              {recentFills.length === 0 ? (
                <div className="text-xs text-gray-500">{t('noRecentFills')}</div>
              ) : (
                recentFills.slice(0, 6).map((fill) => (
                  <div key={fill.id} className="flex items-center justify-between gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <span>
                      {fill.shares.toFixed(2)} @ {formatPercent(fill.price)}
                    </span>
                    <span className="text-gray-500">
                      @{fill.makerUser.username} -&gt; @{fill.takerUser.username}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <Modal isOpen={confirmOpen && mode === 'AMM'} onClose={() => setConfirmOpen(false)} title={t('confirmTitle')}>
        <div className="space-y-4">
          <div className="bg-gray-100 dark:bg-gray-700/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('action')}</span>
              <span className="text-gray-900 dark:text-white font-medium">{tradeType} {selectedOutcome}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('shares')}</span>
              <span className="text-gray-900 dark:text-white font-medium">{shares}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('pricePerShare')}</span>
              <span className="text-gray-900 dark:text-white font-medium">{preview && formatPercent(preview.price)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-300 dark:border-gray-600 pt-2">
              <span className="text-gray-600 dark:text-gray-400">{tradeType === 'BUY' ? t('estCost') : t('estProceeds')}</span>
              <span className="text-gray-900 dark:text-white font-bold">{preview && formatCurrency(preview.cost)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {t('priceWarning')}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>{tCommon('cancel')}</Button>
            <Button
              className="flex-1"
              onClick={handleTrade}
              loading={loading}
              variant={selectedOutcome === 'YES' ? 'primary' : 'danger'}
            >
              {t('confirmBtn', { type: tradeType })}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
