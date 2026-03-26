import { SummaryCardSkeleton } from '@/components/SectionSkeletons'

export default function PortfolioLoading() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <SummaryCardSkeleton key={i} />
      ))}
    </div>
  )
}