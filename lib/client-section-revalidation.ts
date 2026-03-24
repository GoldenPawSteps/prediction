/**
 * Background Section Revalidation
 * Enables automatic refresh of individual page sections
 * Provides real-time updates without interrupting user interaction
 */

'use client'

interface RevalidationConfig {
  // How often to revalidate this section (ms)
  interval: number
  // Whether to revalidate immediately on mount
  immediate?: boolean
  // Max number of retries on failure
  maxRetries?: number
  // Delay between retries (ms)
  retryDelay?: number
  // Whether to log debug info (visible in admin console)
  debug?: boolean
}

interface ActiveRevalidation {
  timeoutId: NodeJS.Timeout | number
  isRunning: boolean
  failureCount: number
}

const ACTIVE_REVALIDATIONS = new Map<string, ActiveRevalidation>()

/**
 * Start background revalidation of a section
 * Automatically fetches fresh data and updates component
 *
 * @param sectionKey - Unique identifier for this section
 * @param fetchFn - Async function that fetches and updates section data
 * @param config - Revalidation configuration
 */
export function startSectionRevalidation(
  sectionKey: string,
  fetchFn: () => Promise<unknown>,
  config: RevalidationConfig
): () => void {
  const {
    interval,
    immediate = false,
    maxRetries = 3,
    retryDelay = 2000,
    debug = false,
  } = config

  // Clean up existing revalidation if any
  stopSectionRevalidation(sectionKey)

  const revalidation: ActiveRevalidation = {
    timeoutId: 0,
    isRunning: true,
    failureCount: 0,
  }

  const scheduleNext = () => {
    if (!revalidation.isRunning) return

    revalidation.timeoutId = (typeof globalThis !== 'undefined'
      ? globalThis.setTimeout
      : setTimeout)(async () => {
      try {
        await fetchFn()
        revalidation.failureCount = 0

        if (debug) {
          console.log(
            `[section-revalidation] ✓ Successfully revalidated ${sectionKey}`
          )
        }

        scheduleNext()
      } catch (err) {
        revalidation.failureCount++

        if (debug) {
          console.warn(
            `[section-revalidation] ✗ Failed to revalidate ${sectionKey} (attempt ${revalidation.failureCount}/${maxRetries}):`,
            err
          )
        }

        if (revalidation.failureCount >= maxRetries) {
          if (debug) {
            console.error(
              `[section-revalidation] Giving up on ${sectionKey} after ${maxRetries} failures`
            )
          }
          stopSectionRevalidation(sectionKey)
        } else {
          // Retry with exponential backoff
          revalidation.timeoutId = (typeof globalThis !== 'undefined'
            ? globalThis.setTimeout
            : setTimeout)(
            scheduleNext,
            retryDelay * Math.pow(2, revalidation.failureCount - 1)
          )
        }
      }
    }, interval)
  }

  ACTIVE_REVALIDATIONS.set(sectionKey, revalidation)

  if (immediate) {
    // Run immediately, then schedule next
    fetchFn()
      .then(() => {
        revalidation.failureCount = 0
        scheduleNext()
      })
      .catch((err) => {
        console.error(`[section-revalidation] Initial fetch failed for ${sectionKey}:`, err)
        revalidation.failureCount++
        scheduleNext()
      })
  } else {
    scheduleNext()
  }

  if (debug) {
    console.log(
      `[section-revalidation] Started revalidation for ${sectionKey} (interval: ${interval}ms)`
    )
  }

  // Return cleanup function
  return () => stopSectionRevalidation(sectionKey)
}

/**
 * Stop background revalidation for a section
 */
export function stopSectionRevalidation(sectionKey: string): void {
  const revalidation = ACTIVE_REVALIDATIONS.get(sectionKey)
  if (!revalidation) return

  revalidation.isRunning = false
  if (typeof globalThis !== 'undefined') {
    globalThis.clearTimeout(revalidation.timeoutId as any)
  } else {
    clearTimeout(revalidation.timeoutId as any)
  }

  ACTIVE_REVALIDATIONS.delete(sectionKey)
}

/**
 * Stop all active revalidations
 * Useful for cleanup when leaving a page
 */
export function stopAllSectionRevalidations(): void {
  ACTIVE_REVALIDATIONS.forEach((_, key) => {
    stopSectionRevalidation(key)
  })
}

/**
 * Manually trigger immediate revalidation
 * Useful for user-initiated refresh or sync
 */
export async function revalidateSectionNow(
  sectionKey: string,
  fetchFn: () => Promise<unknown>
): Promise<void> {
  try {
    await fetchFn()
    const revalidation = ACTIVE_REVALIDATIONS.get(sectionKey)
    if (revalidation) {
      revalidation.failureCount = 0
    }
  } catch (err) {
    console.error(`[section-revalidation] Manual revalidation failed for ${sectionKey}:`, err)
    throw err
  }
}

/**
 * Get stats on active revalidations (admin diagnostics)
 */
export function getSectionRevalidationStats() {
  const stats = {
    totalActive: ACTIVE_REVALIDATIONS.size,
    sections: Array.from(ACTIVE_REVALIDATIONS.entries()).map(([key, val]) => ({
      key,
      isRunning: val.isRunning,
      failureCount: val.failureCount,
    })),
  }
  return stats
}
