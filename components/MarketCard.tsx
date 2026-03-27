import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatPercent, getCategoryColor } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { useI18n, useT } from '@/context/I18nContext'
import { prefetchJson } from '@/lib/client-prefetch'
import { startAdminNavMetric } from '@/lib/client-nav-metrics'
import { beginNavFeedback } from '@/lib/client-nav-feedback'
import { useAuth } from '@/context/AuthContext'

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

  if (absMs < minute) {
    return rtf.format(Math.round(diffMs / 1000), 'second')
  }
  if (absMs < hour) {
    return rtf.format(Math.round(diffMs / minute), 'minute')
  }
  if (absMs < day) {
    return rtf.format(Math.round(diffMs / hour), 'hour')
  }
  if (absMs < month) {
    return rtf.format(Math.round(diffMs / day), 'day')
  }
  if (absMs < year) {
    return rtf.format(Math.round(diffMs / month), 'month')
  }
  return rtf.format(Math.round(diffMs / year), 'year')
}

function translateCategory(category: string, tCategories: ReturnType<typeof useT<'categories'>>): string {
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

function translateStatus(status: string, tStatus: ReturnType<typeof useT<'status'>>): string {
  switch (status) {
    case 'OPEN': return tStatus('open')
    case 'CLOSED': return tStatus('closed')
    case 'DISPUTED': return tStatus('disputed')
    case 'INVALID': return tStatus('invalid')
    case 'RESOLVED': return tStatus('resolved')
    default: return status
  }
}

interface Market {
  id: string
  title: string
  marketType?: 'BINARY' | 'MULTI'
  category: string
  status: string
  totalVolume: number
  endDate: string
  probabilities: { yes: number; no: number }
  outcomes?: Array<{
    id: string
    outcomeName: string | null
    probabilities: { yes: number; no: number }
  }>
  _count?: { trades: number; comments: number }
  creator?: { username: string; avatar: string | null }
}

interface MarketCardProps {
  market: Market
}

export function MarketCard({ market }: MarketCardProps) {
  const router = useRouter()
  const { user } = useAuth()
  const { locale } = useI18n()
  const tCard = useT('marketCard')
  const tCommon = useT('common')
  const tCategories = useT('categories')
  const tStatus = useT('status')
  const tAdmin = useT('admin')
  const detailHref = `/markets/${market.id}`
  const marketApiKey = `market:${market.id}`
  const isMulti = market.marketType === 'MULTI'
  const yesProb = market.probabilities.yes
  const noProb = market.probabilities.no
  const isExpired = new Date(market.endDate) < new Date()

  const handleIntentPrefetch = () => {
    router.prefetch(detailHref)
    void prefetchJson(marketApiKey, `/api/markets/${market.id}`)
  }

  const handleMarketClick = () => {
    beginNavFeedback(detailHref)
    startAdminNavMetric(detailHref, user?.isAdmin)
    handleIntentPrefetch()
  }

  return (
    <Link
      href={detailHref}
      onMouseEnter={handleIntentPrefetch}
      onFocus={handleIntentPrefetch}
      onTouchStart={handleIntentPrefetch}
      onClick={handleMarketClick}
      className="block h-full"
    >
      <div className="h-full bg-white/95 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 hover:border-indigo-500/50 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10 dark:hover:bg-gray-900 hover-smooth cursor-pointer group">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${getCategoryColor(market.category)}`}>
            {translateCategory(market.category, tCategories)}
          </span>
          <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-gray-500'}`}>
            {isExpired ? tCard('expired') : formatRelativeTime(market.endDate, locale)}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-gray-900 dark:text-white font-semibold text-sm mb-4 line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors min-h-10">
          {market.title}
        </h3>

        {/* Probability / Outcomes */}
        <div className="mb-3">
          {isMulti ? (
            <div className="space-y-1.5">
              {(market.outcomes ?? []).slice(0, 3).map((outcome) => (
                <div key={outcome.id} className="text-xs flex items-center justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400 truncate">{outcome.outcomeName || 'Outcome'}</span>
                  <span className="text-indigo-500 dark:text-indigo-300 font-semibold">{formatPercent(outcome.probabilities.yes)}</span>
                </div>
              ))}
              {(market.outcomes?.length ?? 0) > 3 && (
                <div className="text-[11px] text-gray-500 dark:text-gray-500">
                  +{(market.outcomes?.length ?? 0) - 3} outcomes
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-green-400 font-semibold">{tAdmin('yes')} {formatPercent(yesProb)}</span>
                <span className="text-red-400 font-semibold">{tAdmin('no')} {formatPercent(noProb)}</span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                  style={{ width: `${yesProb * 100}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500 gap-2">
          <span>{tCard('vol')}: <span className="text-gray-700 dark:text-gray-400">{formatCurrency(market.totalVolume)}</span></span>
          <span>{market._count?.trades || 0} {tCommon('trades')}</span>
          {market.status !== 'OPEN' && (
            <Badge variant={market.status === 'RESOLVED' ? 'info' : market.status === 'INVALID' ? 'danger' : 'warning'}>
              {translateStatus(market.status, tStatus)}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  )
}
