'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { formatCurrency } from '@/lib/utils'
import { prefetchJson } from '@/lib/client-prefetch'
import { prefetchSection } from '@/lib/client-section-prefetch'
import { startAdminNavMetric } from '@/lib/client-nav-metrics'
import { beginNavFeedback, endNavFeedback } from '@/lib/client-nav-feedback'

export function Navbar() {
    // Ensure nav loading bar is cleared on initial mount (refresh or same-route nav)
    useEffect(() => {
      endNavFeedback()
    }, [])
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const isAuthenticated = Boolean(user)
  const isAdmin = Boolean(user?.isAdmin)
  const t = useT('nav')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = () => {
    if (loggingOut) return
    setLoggingOut(true)
    // Cancel any pending navigation watchdog before navigating away.
    endNavFeedback()
    // Clear stale post-create back target so the next user doesn't land on
    // the previous user's market detail page.
    try { window.sessionStorage.removeItem('predictify:post-create-back-target') } catch {}
    // Fire-and-forget: POST invalidates session + clears cookies server-side.
    // keepalive ensures the request completes even as the page unloads.
    try {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      })
    } catch {
      // Swallow — hard navigation below is the source of truth.
    }
    // Immediate hard navigation. No async gaps, no waiting for the POST.
    window.location.replace('/auth/login')
  }

  const navLinks = [
    { href: '/', label: t('markets') },
    { href: '/leaderboard', label: t('leaderboard') },
    ...(user ? [{ href: '/portfolio', label: t('portfolio') }] : []),
    ...(user?.isAdmin ? [{ href: '/admin', label: t('admin') }] : []),
  ]

  const isMarketDetail = /^\/markets\/(?!create$)[^/]+$/.test(pathname)

  const handleNavIntentPrefetch = (href: string) => {
    router.prefetch(href)

    if (href === '/leaderboard') {
      void prefetchJson('leaderboard:profit', '/api/leaderboard?sortBy=profit')
      void prefetchSection({
        key: 'leaderboard-table:profit',
        url: '/api/leaderboard?sortBy=profit',
      })
    }

    if (href === '/portfolio' && user) {
      void prefetchJson('portfolio:me', '/api/portfolio', { credentials: 'include' })
      void prefetchSection({
        key: 'portfolio-summary',
        url: '/api/portfolio',
        init: { credentials: 'include' },
      })
      void prefetchSection({
        key: 'portfolio-positions',
        url: '/api/portfolio',
        init: { credentials: 'include' },
      })
      void prefetchSection({
        key: 'portfolio-trades',
        url: '/api/portfolio',
        init: { credentials: 'include' },
      })
    }
  }

  const handleNavClick = (href: string) => {
    beginNavFeedback(href)
    startAdminNavMetric(href, user?.isAdmin)
    handleNavIntentPrefetch(href)
  }

  useEffect(() => {
    endNavFeedback()
  }, [pathname])

  useEffect(() => {
    const idlePrefetch = () => {
      router.prefetch('/leaderboard')
      void prefetchJson('leaderboard:profit', '/api/leaderboard?sortBy=profit')
      void prefetchSection({
        key: 'leaderboard-table:profit',
        url: '/api/leaderboard?sortBy=profit',
      })

      if (isAuthenticated) {
        router.prefetch('/portfolio')
        router.prefetch('/markets/create')
        void prefetchJson('portfolio:me', '/api/portfolio', { credentials: 'include' })
        void prefetchSection({
          key: 'portfolio-summary',
          url: '/api/portfolio',
          init: { credentials: 'include' },
        })
        void prefetchSection({
          key: 'portfolio-positions',
          url: '/api/portfolio',
          init: { credentials: 'include' },
        })
        void prefetchSection({
          key: 'portfolio-trades',
          url: '/api/portfolio',
          init: { credentials: 'include' },
        })
      } else {
        router.prefetch('/auth/login')
        router.prefetch('/auth/register')
      }

      if (isAdmin) {
        router.prefetch('/admin')
      }
    }

    if (typeof window === 'undefined') return

    const win = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (id: number) => void
    }

    if (typeof win.requestIdleCallback === 'function' && typeof win.cancelIdleCallback === 'function') {
      const id = win.requestIdleCallback(idlePrefetch, { timeout: 1200 })
      return () => win.cancelIdleCallback?.(id)
    }

    const timeout = globalThis.setTimeout(idlePrefetch, 500)
    return () => globalThis.clearTimeout(timeout)
  }, [isAdmin, isAuthenticated, router])

  return (
    <nav className="sticky top-0 z-40 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">Predictify</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onMouseEnter={() => handleNavIntentPrefetch(link.href)}
                onFocus={() => handleNavIntentPrefetch(link.href)}
                onClick={() => handleNavClick(link.href)}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? 'text-gray-900 bg-gray-100 dark:text-white dark:bg-gray-800'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* User Actions */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="text-green-400 font-semibold">{formatCurrency(user.balance)}</span>
                </div>
                <Link href="/markets/create">
                  <Button size="sm">{t('createMarket')}</Button>
                </Link>
                <div className="flex items-center gap-2">
                  <Link href="/profile" className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                    <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold text-xs">
                      {user.username[0].toUpperCase()}
                    </div>
                  </Link>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm transition-colors disabled:opacity-60"
                  >
                    {loggingOut ? t('loggingOut') : t('logout')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link href="/auth/login">
                  <Button variant="ghost" size="sm">{t('login')}</Button>
                </Link>
                <Link href="/auth/register">
                  <Button size="sm">{t('register')}</Button>
                </Link>
              </>
            )}
          </div>

          {/* Back + Mobile menu button */}
          <div className="md:hidden flex items-center gap-1">
            {isMarketDetail && (
              <button
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white p-1.5 -ml-1.5"
                onClick={() => {
                  const postCreateBackTarget = window.sessionStorage.getItem('predictify:post-create-back-target')
                  if (postCreateBackTarget) {
                    window.sessionStorage.removeItem('predictify:post-create-back-target')
                    window.location.assign(postCreateBackTarget)
                    return
                  }

                  if (window.history.length > 1) router.back()
                  else router.push('/')
                }}
                aria-label="Back"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <button
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileOpen && (
          <div className="md:hidden pb-4 space-y-1">
            <div className="px-3 py-2 flex gap-2">
              <LanguageSwitcher className="flex-1 justify-center" />
            </div>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onMouseEnter={() => handleNavIntentPrefetch(link.href)}
                onFocus={() => handleNavIntentPrefetch(link.href)}
                className="block px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                onClick={() => {
                  handleNavClick(link.href)
                  setMobileOpen(false)
                }}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <>
                <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">{t('balance')}: <span className="text-green-400 font-semibold">{formatCurrency(user.balance)}</span></div>
                <Link href="/markets/create" onClick={() => setMobileOpen(false)}>
                  <Button size="sm" className="w-full mb-2">{t('createMarket')}</Button>
                </Link>
                <button
                  onClick={() => {
                    handleLogout()
                  }}
                  disabled={loggingOut}
                  className="w-full text-left px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  {loggingOut ? t('loggingOut') : t('logout')}
                </button>
              </>
            ) : (
              <div className="flex gap-2 px-3 pt-2">
                <Link href="/auth/login" onClick={() => setMobileOpen(false)}><Button variant="ghost" size="sm">{t('login')}</Button></Link>
                <Link href="/auth/register" onClick={() => setMobileOpen(false)}><Button size="sm">{t('register')}</Button></Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
