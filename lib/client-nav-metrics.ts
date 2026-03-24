const NAV_METRIC_KEY = '__predictify_nav_metric__'

type NavMetric = {
  href: string
  startedAt: number
}

export function startAdminNavMetric(href: string, isAdmin: boolean | undefined) {
  if (!isAdmin || typeof window === 'undefined') return

  const payload: NavMetric = {
    href,
    startedAt: performance.now(),
  }

  window.sessionStorage.setItem(NAV_METRIC_KEY, JSON.stringify(payload))
}

export function finishAdminNavMetric(href: string, isAdmin: boolean | undefined, label: string) {
  if (!isAdmin || typeof window === 'undefined') return

  const raw = window.sessionStorage.getItem(NAV_METRIC_KEY)
  if (!raw) return

  let payload: NavMetric | null = null
  try {
    payload = JSON.parse(raw) as NavMetric
  } catch {
    window.sessionStorage.removeItem(NAV_METRIC_KEY)
    return
  }

  if (!payload || payload.href !== href) return

  const durationMs = performance.now() - payload.startedAt
  console.info(`[admin-nav-metric] ${label} ready in ${durationMs.toFixed(1)}ms`)
  window.sessionStorage.removeItem(NAV_METRIC_KEY)
}