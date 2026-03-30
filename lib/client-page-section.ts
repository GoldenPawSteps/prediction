/**
 * usePageSection - Progressive Loading Hook
 * Combines prefetching, per-section loading state, and background revalidation
 * Enables "instant-feel" navigation where sections load independently
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { consumePrefetchedSection, prefetchSection } from '@/lib/client-section-prefetch'
import { startSectionRevalidation } from '@/lib/client-section-revalidation'

interface UseSectionOptions {
  // Unique cache/revalidation key for this section
  key: string
  // URL to fetch data from
  url: string
  // How often to revalidate in background (ms), 0 to disable
  revalidateInterval?: number
  // Whether data was prefetched (check cache first)
  shouldConsume?: boolean
  // Custom fetch options
  fetchInit?: RequestInit
  // Admin-only revalidation logging
  debug?: boolean
}

interface UseSectionReturn<T> {
  // Fetched data or null
  data: T | null
  // Is this the initial load (before first data fetch)
  isLoading: boolean
  // Is data currently stale (will be refreshed in background)
  isStale: boolean
  // Manual refetch function
  refetch: () => Promise<unknown>
  // Last error if any
  error: Error | null
}

/**
 * Hook for progressive per-section data loading
 * - Consumes prefetched data first if available
 * - Shows loading skeleton while fetching
 * - Automatically refetches in background with configurable interval
 * - Returns clean interface: data, isLoading, isStale, refetch
 *
 * Usage:
 * const { data: comments, isLoading } = usePageSection<Comment[]>({
 *   key: 'market-comments:123',
 *   url: `/api/markets/123/comments`,
 *   revalidateInterval: 10_000, // Refetch every 10 seconds
 *   shouldConsume: true, // Check prefetch cache first
 * })
 *
 * return isLoading ? <CommentSkeleton /> : <Comments data={data} />
 */
export function usePageSection<T>({
  key,
  url,
  revalidateInterval = 0,
  shouldConsume = true,
  fetchInit,
  debug = false,
}: UseSectionOptions): UseSectionReturn<T> {
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStale] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const isMountedRef = useRef(true)
  const revalidateCleanupRef = useRef<(() => void) | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  // Tracks serialized last-known data to skip re-renders when response is unchanged
  const dataJsonRef = useRef<string | null>(null)
  const hasLoadedDataRef = useRef(false)

  // Fetch function that can be called manually or by revalidation
  const fetchData = useCallback(async () => {
    try {
      // First: try to consume prefetched data
      if (shouldConsume && !hasLoadedDataRef.current) {
        const prefetched = consumePrefetchedSection<T>(key)
        if (prefetched) {
          if (isMountedRef.current) {
            // Prefetch succeeded before first fetch
            dataJsonRef.current = JSON.stringify(prefetched)
            hasLoadedDataRef.current = true
            setData(prefetched)
            setIsLoading(false)
            setError(null)
          }
          return prefetched
        }
      }

      // Abort any previous in-flight request to prevent races
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      // Second: fetch fresh data from network (no visual stale indicator —
      // background revalidations are silent to avoid flickering)
      const res = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
        cache: 'no-store',
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch ${key}: ${res.status}`)
      }

      const newData = await res.json() as T

      if (isMountedRef.current) {
        // Only update state when the response payload has actually changed,
        // preventing unnecessary re-renders on identical polling responses.
        const newJson = JSON.stringify(newData)
        if (newJson !== dataJsonRef.current) {
          dataJsonRef.current = newJson
          hasLoadedDataRef.current = true
          setData(newData)
        }
        setIsLoading(false)
        setError(null)

        if (debug) {
          console.log(`[section-load] ✓ ${key} loaded successfully`)
        }
      }

      return newData
    } catch (err) {
      // Silently ignore aborted requests — they are intentional cancellations
      if (err instanceof DOMException && err.name === 'AbortError') {
        return undefined as unknown as T
      }

      const error = err instanceof Error ? err : new Error(String(err))

      if (isMountedRef.current) {
        setError(error)
        setIsLoading(false)

        if (debug) {
          console.warn(`[section-load] ✗ ${key} failed:`, error)
        }
      }

      throw error
    }
  }, [key, url, shouldConsume, fetchInit, debug])

  // Initial load on mount
  useEffect(() => {
    isMountedRef.current = true

    // Fetch from cache or network.
    fetchData().catch(() => {
      // Error already handled in fetchData via setError
    })

    return () => {
      isMountedRef.current = false
      // Cancel any in-flight request on unmount / dependency change
      abortControllerRef.current?.abort()
    }
  }, [fetchData])

  // Set up background revalidation if interval specified
  useEffect(() => {
    if (revalidateInterval <= 0) return

    // Start revalidation and store cleanup function
    revalidateCleanupRef.current = startSectionRevalidation(
      key,
      fetchData,
      {
        interval: revalidateInterval,
        immediate: false, // Don't fetch immediately, let initial load handle it
        maxRetries: 5,
        retryDelay: 2000,
        debug,
      }
    )

    return () => {
      // Cleanup revalidation on unmount or interval change
      if (revalidateCleanupRef.current) {
        revalidateCleanupRef.current()
        revalidateCleanupRef.current = null
      }
    }
  }, [revalidateInterval, key, fetchData, debug])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (revalidateCleanupRef.current) {
        revalidateCleanupRef.current()
      }
    }
  }, [])

  return {
    data,
    isLoading,
    isStale,
    refetch: fetchData,
    error,
  }
}

/**
 * Hook for prefetching multiple sections ahead of time
 * Useful for navbar intelligent prefetch
 *
 * Usage:
 * usePrefetchSections([
 *   { key: 'leaderboard:top', url: '/api/leaderboard?limit=10' },
 *   { key: 'portfolio:summary', url: '/api/portfolio/summary' },
 * ])
 */
export function usePrefetchSections(
  sections: Array<{ key: string; url: string }>
): void {
  useEffect(() => {
    sections.forEach(({ key, url }) => {
      prefetchSection({ key, url })
    })
  }, [sections])
}
