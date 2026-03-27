/**
 * Section-Level Prefetch Cache
 * Enables independent prefetching of page sections for granular loading
 * Complements full-page prefetch for scenarios where sections load separately
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

type SectionPrefetchPromiseMap = Partial<Record<string, Promise<void>>>

const SECTION_CACHE = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 45_000 // Slightly longer than full-page cache (30s) to support section refresh

function getSectionPrefetchPromiseMap(): SectionPrefetchPromiseMap {
  const scopedGlobal = globalThis as typeof globalThis & {
    __sectionPrefetchPromises?: SectionPrefetchPromiseMap
  }
  if (!scopedGlobal.__sectionPrefetchPromises) {
    scopedGlobal.__sectionPrefetchPromises = {}
  }
  return scopedGlobal.__sectionPrefetchPromises
}

export interface SectionPrefetchOptions {
  /** Cache key for deduplication */
  key: string
  /** URL to fetch from */
  url: string
  /** Request init options */
  init?: RequestInit
  /** Cache TTL in ms (default 45s) */
  ttl?: number
}

/**
 * Start prefetching a specific page section
 * Deduplicates in-flight requests for the same key
 * Returns promise that resolves when data is cached
 */
export async function prefetchSection<T>(
  options: SectionPrefetchOptions
): Promise<void> {
  const { key, url, init, ttl = CACHE_TTL_MS } = options

  // If we have fresh data, return immediately
  const entry = SECTION_CACHE.get(key) as CacheEntry<T> | undefined
  if (entry && entry.expiresAt > Date.now()) {
    return // Data is fresh, no need to refetch
  }

  // If prefetch is already in-flight, wait for it
  const inFlight = getSectionPrefetchPromiseMap()
  if (inFlight[key]) {
    return inFlight[key]
  }

  // Start new prefetch
  const promise = fetch(url, init)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to prefetch section: ${res.status}`)
      return res.json()
    })
    .then((data: T) => {
      // Cache the data with TTL
      SECTION_CACHE.set(key, {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttl,
      })
    })
    .catch((err) => {
      console.warn(`[section-prefetch] Failed to prefetch ${key}:`, err)
    })
    .finally(() => {
      // Clear promise reference
      const pending = getSectionPrefetchPromiseMap()
      delete pending[key]
    })

  // Track in-flight promise to deduplicate
  inFlight[key] = promise

  return promise
}

/**
 * Consume cached section data and clear cache entry
 * Safe to call even if data wasn't prefetched (returns undefined)
 */
export function consumePrefetchedSection<T>(key: string): T | undefined {
  const entry = SECTION_CACHE.get(key) as CacheEntry<T> | undefined

  if (!entry) return undefined

  // Check if data is still fresh
  if (entry.expiresAt <= Date.now()) {
    SECTION_CACHE.delete(key)
    return undefined
  }

  // Return data and remove from cache (one-time consumption)
  SECTION_CACHE.delete(key)
  return entry.data
}

/**
 * Clear all section cache entries
 * Useful for manual cache invalidation
 */
export function clearSectionCache(): void {
  SECTION_CACHE.clear()
  const inFlight = getSectionPrefetchPromiseMap()
  Object.keys(inFlight).forEach((key) => {
    delete inFlight[key]
  })
}

/**
 * Warm multiple sections at once
 * Useful for predictive prefetching
 */
export async function prefetchSections(
  sections: Array<SectionPrefetchOptions>
): Promise<void> {
  await Promise.all(sections.map((section) => prefetchSection(section)))
}

/**
 * Get cache stats (for admin diagnostics)
 */
export function getSectionCacheStats() {
  const stats = {
    entries: SECTION_CACHE.size,
    totalSize: 0,
    freshEntries: 0,
    staleEntries: 0,
  }

  SECTION_CACHE.forEach((entry) => {
    const isFresh = entry.expiresAt > Date.now()
    if (isFresh) stats.freshEntries++
    else stats.staleEntries++

    // Rough size estimate
    stats.totalSize += JSON.stringify(entry.data).length
  })

  return stats
}
