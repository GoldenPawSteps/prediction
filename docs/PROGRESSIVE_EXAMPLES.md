# Progressive Loading - Integration Examples

This directory contains reference implementations showing how to apply progressive section loading to different page types.

## Leaderboard Page Example

See `LEADERBOARD_PROGRESSIVE.md` for a complete leaderboard implementation with:
- Summary stats section (loads first, high refresh rate)
- Leaderboard table (loads independently)
- Sort switching with progressive reload
- Independent error boundaries per section

**Key patterns:**
- Summary card renders with skeleton in 100-200ms
- Table lazy-loads after summary
- Sorting changes trigger section-specific refresh
- All sections have independent error handling

## Portfolio Page Example  

See `PORTFOLIO_PROGRESSIVE.MD` for portfolio dashboard with:
- Portfolio summary stats (instant feedback)
- Open positions table (medium priority)
- Trade history table (lowest priority)
- Each section loads independently with its own skeleton

**Key patterns:**
- Stats refresh every 10 seconds (user-facing)
- Positions refresh every 15 seconds (portfolio changes)
- Trade history refresh every 30 seconds (historical, less critical)
- Each section can fail without breaking the page

## Market Detail Page (LIVE)

The market detail page is already refactored with `MarketCommentsSection` component:
- Comments load as progressive section
- Independent from market data fetch
- Auto-refresh every 8 seconds
- Separate error boundary
- Based in: `/components/sections/MarketCommentsSection.tsx`

To add more sections to market detail, copy the pattern from MarketCommentsSection.

## Implementation Checklist

For each page section:

- [ ] Create API endpoint returning section-specific data (optional, can reuse existing)
- [ ] Create component using `usePageSection` hook
- [ ] Wrap in `<SectionErrorBoundary>`
- [ ] Show skeleton while `isLoading`
- [ ] Show "Updating..." indicator when `isStale`
- [ ] Set appropriate `revalidateInterval` based on priority
- [ ] Test with slow network (DevTools throttling)
- [ ] Verify no layout shift between skeleton and content

## Quick Start: Add Your Own Section

```typescript
'use client'

import { usePageSection } from '@/lib/client-page-section'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { MySkeleton } from '@/components/SectionSkeletons'

interface MyData {
  // ...
}

export function MySection({ id }: { id: string }) {
  const t = useT('myNamespace')
  
  // This hook handles prefetch + refresh automatically
  const { data, isLoading, isStale, refetch } = usePageSection<MyData>({
    key: `my-section:${id}`,
    url: `/api/my-endpoint/${id}`,
    revalidateInterval: 10_000, // 10 seconds
    shouldConsume: true, // Try prefetch cache first
  })

  if (isLoading) return <MySkeleton />
  if (!data) return null

  return (
    <SectionErrorBoundary sectionName="my-section">
      <div className={isStale ? 'opacity-60' : ''}>
        {/* Your section content */}
      </div>
    </SectionErrorBoundary>
  )
}
```

## Performance Characteristics

Typical refresh intervals by section type:

| Section Type | Refresh Interval | Priority | Reason |
|---|---|---|---|
| Summary stats | 5-10s | High | User-facing, impacts decisions |
| Live data (votes, votes) | 3-5s | High | Changes frequently |
| Tables (positions, leaderboard) | 10-15s | Medium | Updates less frequently |
| Historical (trades, disputes) | 30s+ | Low | Static historical data |
| Charts | 20-30s | Medium | Visual updates less critical |

## Prefetch Hints

Navbar and market cards should prefetch sections for the page user is likely to visit:

```typescript
// In navbar or market card on intent:
prefetchSections([
  { key: `market-prob:${id}`, url: `/api/markets/${id}/probability` },
  { key: `market-comments:${id}`, url: `/api/markets/${id}/comments` },
  { key: `market-chart:${id}`, url: `/api/markets/${id}/chart` },
])
```

This makes sections appear instantly when user clicks.

## Debugging

Enable debug logging per section:

```typescript
const { data, isLoading } = usePageSection({
  // ...
  debug: true, // Logs [section-load] messages to console
})
```

In admin console:

```javascript
// Check what's cached
import { getSectionCacheStats } from '@/lib/client-section-prefetch'
console.log(getSectionCacheStats())

// Check what's revalidating
import { getSectionRevalidationStats } from '@/lib/client-section-revalidation'
console.table(getSectionRevalidationStats().sections)
```
