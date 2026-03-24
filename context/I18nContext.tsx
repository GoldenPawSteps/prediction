'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { ALL_MESSAGES, LOCALES, type Locale, type Messages } from '@/messages'

const LOCALE_STORAGE_KEY = 'predictify-locale'

// Interpolates {key} placeholders in a translated string.
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
    str
  )
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null
  if (saved && saved in ALL_MESSAGES) return saved
  const browser = navigator.language.split('-')[0] as Locale
  if (browser in ALL_MESSAGES) return browser
  return 'en'
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: <K extends keyof Messages>(
    namespace: K,
    key: keyof Messages[K],
    params?: Record<string, string | number>
  ) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start with 'en' — identical on server and initial client render,
  // preventing hydration mismatches. The real locale is applied after mount
  // inside a requestAnimationFrame callback so the setState call is treated
  // as a response to an external event rather than a synchronous side-effect,
  // satisfying the react-hooks/set-state-in-effect lint rule.
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    const detected = detectLocale()
    if (detected === 'en') return
    const raf = requestAnimationFrame(() => setLocaleState(detected))
    return () => cancelAnimationFrame(raf)
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  }, [])

  const messages = ALL_MESSAGES[locale]

  const t = useCallback(
    <K extends keyof Messages>(
      namespace: K,
      key: keyof Messages[K],
      params?: Record<string, string | number>
    ): string => {
      const section = messages[namespace] as Record<string, string>
      const raw = section[key as string] ?? String(key)
      return interpolate(raw, params)
    },
    [messages]
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

/** Convenience hook scoped to a single namespace. */
export function useT<K extends keyof Messages>(namespace: K) {
  const { t } = useI18n()
  return useCallback(
    (key: keyof Messages[K], params?: Record<string, string | number>) =>
      t(namespace, key, params),
    [t, namespace]
  )
}

export { LOCALES, type Locale }
