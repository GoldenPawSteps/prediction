# Progressive Page Sections - Implementation Guide

## Overview

This system enables **instant-feel navigation** by:
1. **Per-section loading** - Each page section loads independently with its own skeleton
2. **Background updates** - Sections automatically refresh on a configurable interval
3. **Independent prefetching** - Sections can be prefetched separately before navigation
4. **Error isolation** - One section failure doesn't break the whole page
5. **Streaming-like experience** - Sections render as soon as they're ready

## Architecture

### Core Libraries

- **`lib/client-section-prefetch.ts`** - Section-level cache with TTL
- **`lib/client-section-revalidation.ts`** - Background refresh scheduling
- **`lib/client-page-section.ts`** - Master hook (`usePageSection`) combining both
- **`components/SectionErrorBoundary.tsx`** - Per-section error handling
- **`components/SectionSkeletons.tsx`** - Lightweight loading states

### Key Hook: `usePageSection<T>(options)`

```typescript
const { data, isLoading, isStale, refetch, error } = usePageSection<T>({
  key: 'market-comments:123',           // Unique cache key
  url: '/api/markets/123/comments',      // Fetch URL
  revalidateInterval: 8000,              // Background refresh (ms)
  shouldConsume: true,                   // Check prefetch cache first
  debug: true,                           // Log to console (admin)
})
```

**Returns:**
- `data: T | null` - Fetched data (null while loading)
- `isLoading: boolean` - First load (before data arrives)
- `isStale: boolean` - Background refresh in progress
- `refetch: () => Promise<void>` - Manual refresh
- `error: Error | null` - Last fetch error

## Implementation Patterns

### Pattern 1: Simple Section Component

```typescript
'use client'

export function MySection({ marketId, isPrefetched }: Props) {
  const { data, isLoading } = usePageSection<MyData>({
    key: `my-section:${marketId}`,
    url: `/api/markets/${marketId}/data`,
    revalidateInterval: 5000,
    shouldConsume: isPrefetched,
  })

  if (isLoading) return <MySkeletonComponent />
  if (!data) return <ErrorComponent />

  return (
    <SectionErrorBoundary sectionName="my-section">
      <div className="...">
        {/* Render data */}
      </div>
    </SectionErrorBoundary>
  )
}
```

### Pattern 2: Interactive Section (with manual refetch)

```typescript
export function CommentsSection({ marketId }: Props) {
  const { data, isLoading, refetch } = usePageSection<Comment[]>({
    key: `comments:${marketId}`,
    url: `/api/markets/${marketId}/comments`,
    revalidateInterval: 8000,
  })

  const handlePostComment = async () => {
    // Post comment...
    await refetch() // Show new comment immediately
  }

  // ...
}
```

### Pattern 3: Predictive Prefetching

```typescript
// In Navbar or on navigation intent:
import { prefetchSections } from '@/lib/client-section-prefetch'

prefetchSections([
  { key: 'market-prob:123', url: '/api/markets/123/probability' },
  { key: 'market-comments:123', url: '/api/markets/123/comments' },
  { key: 'market-chart:123', url: '/api/markets/123/price-history' },
])
```

## Migration Strategy

### Current State
Market detail page loads all data at once:
```typescript
const [market, setMarket] = useState(null)
const [loading, setLoading] = useState(true)

useEffect(() => {
  // Fetch entire market object
  fetch(`/api/markets/${id}`)
})
```

### Step 1: Extract Section Data
Create API endpoints that return just section data (optional):
```typescript
// Existing: GET /api/markets/:id (returns full market)
// New: GET /api/markets/:id/probability (just probabilities)
// New: GET /api/markets/:id/comments (just comments)
// New: GET /api/markets/:id/chart (just price history)
```

Alternative: Reuse existing `/api/markets/:id` endpoint but consume only relevant fields.

### Step 2: Create Section Components
Extract page sections into independent components using `usePageSection`:
```typescript
<MarketProbabilitySection marketId={id} isPrefetched />
<MarketChartSection marketId={id} isPrefetched />
<MarketCommentsSection marketId={id} isPrefetched />
```

### Step 3: Update Main Page
Replace monolithic fetch with section components:
```typescript
export default function MarketPage({ params }) {
  const { id } = use(params)

  return (
    <div className="space-y-6">
      {/* Header - instant, static */}
      <MarketHeaderSection marketId={id} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Probability - prefetched, auto-refreshes */}
          <MarketProbabilitySection marketId={id} isPrefetched />

          {/* Chart - loads after probability */}
          <MarketChartSection marketId={id} isPrefetched />

          {/* Comments - loads last, independent */}
          <MarketCommentsSection marketId={id} isPrefetched />
        </div>
        
        <div>
          <TradePanel marketId={id} />
        </div>
      </div>
    </div>
  )
}
```

### Step 4: Predictive Prefetching
Update navbar/market cards to prefetch sections:
```typescript
import { prefetchSections } from '@/lib/client-section-prefetch'

// In MarketCard onMouseEnter:
handleIntentPrefetch = () => {
  prefetchSection({ key: `market-prob:${id}`, url: `/api/markets/${id}/probability` })
  prefetchSection({ key: `market-comments:${id}`, url: `/api/markets/${id}/comments` })
}
```

## Performance Metrics

With this system, loading feels instant because:

1. **Header appears immediately** - Static metadata is prefetched early
2. **Probability renders next** - Fast, critical data (5-8s predictive prefetch before click)
3. **Chart appears after** - Larger, lower-priority
4. **Comments load last** - Lowest priority, doesn't block interaction
5. **All sections refresh silently** - No layout shift, no interruption

### Typical Flow (Market Detail Page)

```
Navigation Click
  ↓
0ms:  Header renders (static, instant)
100ms: Probability section appears (prefetched)
500ms: Chart begins rendering (starts fetching)
800ms: Chart ready, visible
1200ms: Comments section appears (start skeleton)
1500ms: Comments data available
5000ms: Probability refreshes in background (silent, opacity-60 while stale)
8000ms: Comments refresh in background
13000ms: Probabilities refresh again
...
```

## Admin Diagnostics

Enable debug logging in dev/admin mode:

```typescript
// In component:
const { data, isLoading } = usePageSection({
  // ...
  debug: true, // Shows [section-load] logs in console
})

// View cache stats:
import { getSectionCacheStats } from '@/lib/client-section-prefetch'
console.log(getSectionCacheStats())
// { entries: 5, totalSize: 24000, freshEntries: 4, staleEntries: 1 }

// View revalidation stats:
import { getSectionRevalidationStats } from '@/lib/client-section-revalidation'
console.table(getSectionRevalidationStats().sections)
```

## Best Practices

1. **Fast sections first** (header, metadata)
   - Load instantly, no network dependency
   - `revalidateInterval: 0` (no background refresh)

2. **Medium priority sections** (probability, stats)
   - Preloadable via prefetch cache
   - `revalidateInterval: 5-10s` (frequent updates)

3. **Low priority sections** (comments, disputes)
   - Load after critical data
   - `revalidateInterval: 8-15s` (user-generated)

4. **Interactive sections**
   - Call `refetch()` manually after form submissions
   - Show optimistic updates immediately

5. **Error isolation**
   - Always wrap with `<SectionErrorBoundary>`
   - Failing comment section shouldn't block trading

## Extending to Other Pages

Leaderboard:
- Revalidate table every 10s (live rankings)
- Prefetch top 10 on nav intent
- Paginated sections load independently

Portfolio:
- Summary cards (fast, refresh 5s)
- Positions table (medium, refresh 10s)
- Trade history (slower, refresh 30s)

## Backward Compatibility

These utilities are **opt-in** - existing pages continue working as-is. Adopt progressively:
- Start with non-critical sections (comments, history)
- Move to critical sections once stable
- Existing prefetch cache coexists with section cache

