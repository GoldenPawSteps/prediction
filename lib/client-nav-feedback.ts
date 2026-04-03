const NAV_PENDING_ATTR = 'data-nav-pending'
const NAV_FEEDBACK_TIMEOUT_MS = 1000
const NAV_WATCHDOG_MS = 3000

function logNavDebug(message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return
  const ts = new Date().toISOString()
  if (meta) {
    console.debug(`[nav-feedback] ${ts} ${message}`, meta)
    return
  }
  console.debug(`[nav-feedback] ${ts} ${message}`)
}

function logNavWarning(message: string, meta?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const ts = new Date().toISOString()
  if (meta) {
    console.warn(`[nav-feedback] ${ts} ${message}`, meta)
    return
  }
  console.warn(`[nav-feedback] ${ts} ${message}`)
}

function getNavWindow() {
  if (typeof window === 'undefined') return null
  return window as typeof window & {
    __predictifyNavFeedbackTimeoutId?: number
    __predictifyNavWatchdogId?: number
    __predictifyNavTarget?: string
  }
}

export function beginNavFeedback(targetHref?: string) {
  const navWindow = getNavWindow()
  if (!navWindow) return

  logNavDebug('begin', {
    targetHref: targetHref ?? null,
    pathname: window.location.pathname,
  })

  document.documentElement.setAttribute(NAV_PENDING_ATTR, 'true')

  if (navWindow.__predictifyNavFeedbackTimeoutId) {
    window.clearTimeout(navWindow.__predictifyNavFeedbackTimeoutId)
  }

  navWindow.__predictifyNavFeedbackTimeoutId = window.setTimeout(() => {
    document.documentElement.removeAttribute(NAV_PENDING_ATTR)
    navWindow.__predictifyNavFeedbackTimeoutId = undefined
    logNavDebug('progress-cleared-by-timeout')
  }, NAV_FEEDBACK_TIMEOUT_MS)

  // In development, avoid hard-redirect watchdogs: first-route cold compiles
  // can legitimately exceed watchdog timing and create confusing history states.
  if (process.env.NODE_ENV !== 'production') {
    logNavDebug('watchdog-skipped-in-dev')
    return
  }

  // Navigation watchdog: if the soft navigation hasn't completed after
  // NAV_WATCHDOG_MS, force a hard navigation to bust out of a stuck
  // React transition.
  if (targetHref) {
    if (navWindow.__predictifyNavWatchdogId) {
      window.clearTimeout(navWindow.__predictifyNavWatchdogId)
    }
    navWindow.__predictifyNavTarget = targetHref
    navWindow.__predictifyNavWatchdogId = window.setTimeout(() => {
      logNavDebug('watchdog-fired', {
        target: navWindow.__predictifyNavTarget ?? null,
        pathname: window.location.pathname,
      })
      // Only fire if we're still on the same page (navigation didn't complete)
      if (navWindow.__predictifyNavTarget && window.location.pathname !== navWindow.__predictifyNavTarget) {
        window.location.href = navWindow.__predictifyNavTarget
      }
      navWindow.__predictifyNavTarget = undefined
      navWindow.__predictifyNavWatchdogId = undefined
    }, NAV_WATCHDOG_MS)
    // Also log warning in production when watchdog fires
    if (process.env.NODE_ENV === 'production' && targetHref) {
      const warnTimeoutId = window.setTimeout(() => {
        if (navWindow.__predictifyNavTarget === targetHref) {
          logNavWarning('Navigation appears stuck', {
            target: targetHref,
            pathname: window.location.pathname,
            timeout_ms: NAV_WATCHDOG_MS,
          })
        }
      }, NAV_WATCHDOG_MS - 500) // Warn 500ms before watchdog fires
    }
  }
}

export function endNavFeedback() {
  const navWindow = getNavWindow()
  if (!navWindow) return

  logNavDebug('end', { pathname: window.location.pathname })

  if (navWindow.__predictifyNavFeedbackTimeoutId) {
    window.clearTimeout(navWindow.__predictifyNavFeedbackTimeoutId)
    navWindow.__predictifyNavFeedbackTimeoutId = undefined
  }

  // Cancel navigation watchdog — navigation completed successfully
  if (navWindow.__predictifyNavWatchdogId) {
    window.clearTimeout(navWindow.__predictifyNavWatchdogId)
    navWindow.__predictifyNavWatchdogId = undefined
  }
  navWindow.__predictifyNavTarget = undefined

  document.documentElement.removeAttribute(NAV_PENDING_ATTR)
}
