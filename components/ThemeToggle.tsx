'use client'

import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'predictify-theme'

type ThemeMode = 'light' | 'dark' | 'auto'

const MODES: { value: ThemeMode; icon: string; label: string }[] = [
  { value: 'light', icon: '☀️', label: 'Light' },
  { value: 'auto', icon: '💻', label: 'Auto' },
  { value: 'dark', icon: '🌙', label: 'Dark' },
]

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto'
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved
  return 'auto'
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme(mode: ThemeMode) {
  const theme = resolveTheme(mode)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  // Always initialise with 'auto' so the server and client first-render match.
  // The mount effect below immediately syncs to the real stored preference.
  const [mode, setMode] = useState<ThemeMode>('auto')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const syncTheme = () => {
      const nextMode = getStoredMode()
      setMode((currentMode) => (currentMode === nextMode ? currentMode : nextMode))
      applyTheme(nextMode)
    }

    syncTheme()
    setMounted(true)

    const handlePageShow = () => {
      syncTheme()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncTheme()
      }
    }

    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    applyTheme(mode)

    if (mode !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('auto')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  const cycleMode = () => {
    const idx = MODES.findIndex((m) => m.value === mode)
    const next = MODES[(idx + 1) % MODES.length].value
    setMode(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    applyTheme(next)
  }

  // Before mount, render a placeholder that matches the server HTML (mode='auto')
  // so there is no hydration diff. The boot <script> already applied the correct
  // theme class to <html>, so the page looks correct despite the label saying "Auto".
  const display = mounted ? MODES.find((m) => m.value === mode)! : MODES.find((m) => m.value === 'auto')!

  return (
    <button
      type="button"
      onClick={cycleMode}
      className={`inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 ${className}`}
      aria-label={`Theme: ${display.label}`}
      title={`Theme: ${display.label} — click to cycle`}
      suppressHydrationWarning
    >
      <span suppressHydrationWarning>{display.icon}</span>
      <span suppressHydrationWarning>{display.label}</span>
    </button>
  )
}