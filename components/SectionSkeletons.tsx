/**
 * Section Loading Skeletons
 * Lightweight, reusable skeletons for different section types
 */

'use client'

export function ProbabilityCardSkeleton() {
  return (
    <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 animate-pulse">
      <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-40 mb-4" />
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-200 dark:bg-gray-700 rounded-lg p-3 h-24" />
        <div className="bg-gray-200 dark:bg-gray-700 rounded-lg p-3 h-24" />
      </div>
      <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded-full" />
    </div>
  )
}

export function ChartSectionSkeleton() {
  return (
    <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 animate-pulse">
      <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-48 mb-4" />
      <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded-lg" />
    </div>
  )
}

export function OrderBookSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-40" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-20" />
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ResolutionActivitySkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-48" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="w-2 h-12 bg-gray-300 dark:bg-gray-700 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CommentsSectionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-32" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4 space-y-2">
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24" />
          <div className="h-10 bg-gray-300 dark:bg-gray-700 rounded w-full" />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="grid grid-cols-4 gap-4 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 bg-gray-300 dark:bg-gray-700 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, j) => (
            <div key={j} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SummaryCardSkeleton() {
  return (
    <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-lg p-4 animate-pulse">
      <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24 mb-2" />
      <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-32" />
    </div>
  )
}
