'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { formatCurrency } from '@/lib/utils'

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const t = useT('nav')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      router.replace('/auth/login')
    } finally {
      setLoggingOut(false)
    }
  }

  const navLinks = [
    { href: '/', label: t('markets') },
    { href: '/leaderboard', label: t('leaderboard') },
    ...(user ? [{ href: '/portfolio', label: t('portfolio') }] : []),
    ...(user?.isAdmin ? [{ href: '/admin', label: t('admin') }] : []),
  ]

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
            <ThemeToggle />
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

          {/* Mobile menu button */}
          <button
            className="md:hidden text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
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

        {/* Mobile Menu */}
        {mobileOpen && (
          <div className="md:hidden pb-4 space-y-1">
            <div className="px-3 py-2 flex gap-2">
              <LanguageSwitcher className="flex-1 justify-center" />
              <ThemeToggle className="flex-1 justify-center" />
            </div>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <>
                <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">{t('balance')}: <span className="text-green-400 font-semibold">{formatCurrency(user.balance)}</span></div>
                <button
                  onClick={async () => {
                    await handleLogout()
                    setMobileOpen(false)
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
