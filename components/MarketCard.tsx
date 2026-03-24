import Link from 'next/link'
import { formatCurrency, formatPercent, timeUntil, getCategoryColor } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { useT } from '@/context/I18nContext'

interface Market {
  id: string
  title: string
  category: string
  status: string
  totalVolume: number
  endDate: string
  probabilities: { yes: number; no: number }
  _count?: { trades: number; comments: number }
  creator?: { username: string; avatar: string | null }
}

interface MarketCardProps {
  market: Market
}

export function MarketCard({ market }: MarketCardProps) {
  const tCard = useT('marketCard')
  const tCommon = useT('common')
  const yesProb = market.probabilities.yes
  const noProb = market.probabilities.no
  const isExpired = new Date(market.endDate) < new Date()

  return (
    <Link href={`/markets/${market.id}`}>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 hover:border-indigo-500/50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-200 cursor-pointer group">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${getCategoryColor(market.category)}`}>
            {market.category}
          </span>
          <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-gray-500'}`}>
            {isExpired ? tCard('expired') : timeUntil(market.endDate)}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-gray-900 dark:text-white font-semibold text-sm mb-4 line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
          {market.title}
        </h3>

        {/* Probability Bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-green-400 font-semibold">YES {formatPercent(yesProb)}</span>
            <span className="text-red-400 font-semibold">NO {formatPercent(noProb)}</span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
              style={{ width: `${yesProb * 100}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
          <span>{tCard('vol')}: <span className="text-gray-700 dark:text-gray-400">{formatCurrency(market.totalVolume)}</span></span>
          <span>{market._count?.trades || 0} {tCommon('trades')}</span>
          {market.status !== 'OPEN' && (
            <Badge variant={market.status === 'RESOLVED' ? 'info' : market.status === 'INVALID' ? 'danger' : 'warning'}>
              {market.status}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  )
}
