import React from 'react'

export function MarketListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl h-56 animate-pulse border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-gray-100 via-white to-gray-100 dark:from-gray-800/70 dark:via-gray-900/80 dark:to-gray-800/70"
        />
      ))}
    </div>
  )
}
