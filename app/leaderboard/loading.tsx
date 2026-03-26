import { TableSkeleton } from '@/components/SectionSkeletons'

export default function LeaderboardLoading() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-2">
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-64 animate-pulse" />
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-80 animate-pulse" />
      </div>
      <TableSkeleton rows={5} />
    </div>
  )
}