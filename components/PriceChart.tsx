'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { format } from 'date-fns'

interface PricePoint {
  timestamp: string
  yesPrice: number
  noPrice: number
}

interface ChartPoint {
  x: string
  timeLabel: string
  YES: number
  NO: number
}

interface PriceChartProps {
  data: PricePoint[]
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; name: string; color: string; payload: ChartPoint }>
  label?: string | number
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const tooltipLabel = payload[0]?.payload?.timeLabel ?? String(label ?? '')

    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-gray-400 mb-1">{tooltipLabel}</p>
        {payload.map((p) => (
          <p key={p.name} style={{ color: p.color }} className="font-semibold">
            {p.name}: {(p.value * 100).toFixed(1)}%
          </p>
        ))}
      </div>
    )
  }
  return null
}

export function PriceChart({ data }: PriceChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
        No price history yet
      </div>
    )
  }

  const chartData: ChartPoint[] = data.map((d, index) => {
    const timeLabel = format(new Date(d.timestamp), 'MM/dd HH:mm')

    return {
      // Keep x-axis categories unique so active dots match the actual hovered point.
      x: `${timeLabel}__${index}`,
      timeLabel,
      YES: d.yesPrice,
      NO: d.noPrice,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="x"
          tickFormatter={(value) => String(value).split('__')[0]}
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          tick={{ fill: '#6B7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="YES"
          stroke="#34D399"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="NO"
          stroke="#F87171"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
