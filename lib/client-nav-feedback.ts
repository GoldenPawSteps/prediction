const NAV_PENDING_ATTR = 'data-nav-pending'
const NAV_FEEDBACK_TIMEOUT_MS = 1000
const NAV_WATCHDOG_MS = 3500

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

  document.documentElement.setAttribute(NAV_PENDING_ATTR, 'true')

  if (navWindow.__predictifyNavFeedbackTimeoutId) {
    window.clearTimeout(navWindow.__predictifyNavFeedbackTimeoutId)
  }

  navWindow.__predictifyNavFeedbackTimeoutId = window.setTimeout(() => {
    document.documentElement.removeAttribute(NAV_PENDING_ATTR)
    navWindow.__predictifyNavFeedbackTimeoutId = undefined
  }, NAV_FEEDBACK_TIMEOUT_MS)

  // Navigation watchdog: if the soft navigation hasn't completed after
  // NAV_WATCHDOG_MS, force a hard navigation to bust out of a stuck
  // React transition.
  if (targetHref) {
    if (navWindow.__predictifyNavWatchdogId) {
      window.clearTimeout(navWindow.__predictifyNavWatchdogId)
    }
    navWindow.__predictifyNavTarget = targetHref
    navWindow.__predictifyNavWatchdogId = window.setTimeout(() => {
      // Only fire if we're still on the same page (navigation didn't complete)
      if (navWindow.__predictifyNavTarget && window.location.pathname !== navWindow.__predictifyNavTarget) {
        window.location.href = navWindow.__predictifyNavTarget
      }
      navWindow.__predictifyNavTarget = undefined
      navWindow.__predictifyNavWatchdogId = undefined
    }, NAV_WATCHDOG_MS)
  }
}

export function endNavFeedback() {
  const navWindow = getNavWindow()
  if (!navWindow) return

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
