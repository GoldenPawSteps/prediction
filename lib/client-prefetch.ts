type CacheEntry = {
  timestamp: number
  data?: unknown
  promise?: Promise<unknown>
}

const CACHE_TTL_MS = 30_000
const jsonPrefetchCache = new Map<string, CacheEntry>()

function isFresh(entry: CacheEntry | undefined) {
  return Boolean(entry && Date.now() - entry.timestamp <= CACHE_TTL_MS)
}

function getFreshEntry(key: string) {
  const entry = jsonPrefetchCache.get(key)
  if (!isFresh(entry)) {
    jsonPrefetchCache.delete(key)
    return null
  }
  return entry
}

export async function prefetchJson<T>(key: string, url: string, init?: RequestInit): Promise<T | null> {
  if (typeof window === 'undefined') return null

  const cached = getFreshEntry(key)
  if (cached?.data !== undefined) {
    return cached.data as T
  }
  if (cached?.promise) {
    return (await cached.promise) as T
  }

  const request = fetch(url, init)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Prefetch failed: ${res.status}`)
      }
      const data = (await res.json()) as T
      jsonPrefetchCache.set(key, { timestamp: Date.now(), data })
      return data
    })
    .catch(() => {
      jsonPrefetchCache.delete(key)
      return null
    })

  jsonPrefetchCache.set(key, { timestamp: Date.now(), promise: request })
  return (await request) as T | null
}

export function consumePrefetchedJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null

  const cached = getFreshEntry(key)
  if (!cached || cached.data === undefined) return null

  jsonPrefetchCache.delete(key)
  return cached.data as T
}