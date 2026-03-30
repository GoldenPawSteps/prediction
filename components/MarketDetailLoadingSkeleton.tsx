import { ChartSectionSkeleton } from '@/components/SectionSkeletons'

export function MarketDetailLoadingSkeleton() {
  return (
    <div className="space-y-4 reveal-up" aria-busy="true" aria-live="polite">
      <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-3/4 animate-pulse [animation-duration:1.8s]" />
      <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/2 animate-pulse [animation-duration:1.8s]" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <ChartSectionSkeleton />
        </div>
        <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse [animation-duration:1.8s]" />
      </div>
    </div>
  )
}