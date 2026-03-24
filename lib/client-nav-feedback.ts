const NAV_PENDING_ATTR = 'data-nav-pending'
const NAV_FEEDBACK_TIMEOUT_MS = 6000

function getNavWindow() {
  if (typeof window === 'undefined') return null
  return window as typeof window & { __predictifyNavFeedbackTimeoutId?: number }
}

export function beginNavFeedback() {
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
}

export function endNavFeedback() {
  const navWindow = getNavWindow()
  if (!navWindow) return

  if (navWindow.__predictifyNavFeedbackTimeoutId) {
    window.clearTimeout(navWindow.__predictifyNavFeedbackTimeoutId)
    navWindow.__predictifyNavFeedbackTimeoutId = undefined
  }

  document.documentElement.removeAttribute(NAV_PENDING_ATTR)
}
