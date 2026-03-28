'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react'
import toast from 'react-hot-toast'
import { endNavFeedback } from '@/lib/client-nav-feedback'

const AUTH_REFRESH_INTERVAL_MS = 10000

interface User {
  id: string
  email: string
  username: string
  avatar: string | null
  bio: string | null
  balance: number
  isAdmin: boolean
  createdAt: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<boolean>
  register: (email: string, username: string, password: string) => Promise<boolean>
  logout: () => Promise<boolean>
  refreshUser: () => Promise<void>
  optimisticUpdateBalance: (amount: number) => () => void
  updateProfile: (fields: { username?: string; bio?: string }) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const logoutInProgressRef = useRef(false)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const userSnapshotRef = useRef<string | null>(null)

  const commitUser = useCallback((nextUser: User | null) => {
    const nextSnapshot = nextUser ? JSON.stringify(nextUser) : null
    if (nextSnapshot === userSnapshotRef.current) {
      return
    }

    userSnapshotRef.current = nextSnapshot
    setUser(nextUser)
  }, [])

  const refreshUser = useCallback(async () => {
    if (logoutInProgressRef.current) {
      return
    }

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current
    }

    const run = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        if (logoutInProgressRef.current) {
          return
        }

        if (res.ok) {
          const data = await res.json()
          if (logoutInProgressRef.current) {
            return
          }
          commitUser(data)
          return
        }

        // Retry once on auth failures to avoid brief session flicker caused by
        // transient cookie propagation/race conditions.
        if (res.status === 401 || res.status === 403) {
          await new Promise((resolve) => window.setTimeout(resolve, 150))
          const retry = await fetch('/api/auth/me', { cache: 'no-store' })
          if (retry.ok) {
            const data = await retry.json()
            commitUser(data)
            return
          }

          commitUser(null)
          return
        }

        // Keep the current user on non-auth errors (e.g. 5xx/network edge cases).
      } catch {
        // Do not clear auth state on transient network failures.
      }
    }

    refreshInFlightRef.current = run().finally(() => {
      refreshInFlightRef.current = null
    })

    return refreshInFlightRef.current
  }, [commitUser])

  useEffect(() => {
    let mounted = true

    const initializeAuth = async () => {
      await refreshUser()
      if (mounted) {
        setLoading(false)
      }
    }

    void initializeAuth()

    return () => {
      mounted = false
    }
  }, [refreshUser])

  useEffect(() => {
    // Keep auth-dependent UI (like balance) in sync with market events and order expirations.
    const intervalId = window.setInterval(() => {
      void refreshUser()
    }, AUTH_REFRESH_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshUser()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshUser])

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      const raw = await res.text()
      let data: { user?: User; error?: string } = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = {}
      }

      if (res.ok) {
        if (!data.user) {
          toast.error('Login failed')
          return false
        }
        commitUser(data.user)
        toast.success('Welcome back!')
        return true
      } else {
        toast.error(data.error || `Login failed (${res.status})`)
        return false
      }
    } catch {
      toast.error('Network error')
      return false
    }
  }

  const register = async (email: string, username: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, username, password }),
      })
      const raw = await res.text()
      let data: { user?: User; error?: string } = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = {}
      }

      if (res.ok) {
        if (!data.user) {
          toast.error('Registration failed')
          return false
        }
        commitUser(data.user)
        toast.success('Account created!')
        return true
      } else {
        toast.error(data.error || `Registration failed (${res.status})`)
        return false
      }
    } catch {
      toast.error('Network error')
      return false
    }
  }

  const logout = async (): Promise<boolean> => {
    if (logoutInProgressRef.current) {
      return false
    }

    endNavFeedback()
    logoutInProgressRef.current = true
    commitUser(null)
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        keepalive: true,
      })

      if (!res.ok) {
        // Fall back to a hard server-side logout that clears cookies and redirects.
        window.location.href = '/api/auth/logout?next=/auth/login'
        return false
      }

      toast.success('Logged out')
      return true
    } catch {
      // Network/transient fetch failures should still fully log out.
      window.location.href = '/api/auth/logout?next=/auth/login'
      return false
    } finally {
      // Keep refresh blocked briefly so cookie invalidation can settle before
      // background visibility/interval refreshes run.
      window.setTimeout(() => {
        logoutInProgressRef.current = false
      }, 300)
    }
  }

  const optimisticUpdateBalance = (amount: number) => {
    const previousUser = user
    if (user) {
      commitUser({ ...user, balance: user.balance - amount })
    }
    // Verify in background (don't block)
    refreshUser().catch(() => {
      if (previousUser) commitUser(previousUser)
    })
    // Return rollback function
    return () => {
      if (previousUser) commitUser(previousUser)
    }
  }

  const updateProfile = async (fields: { username?: string; bio?: string }): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(fields),
      })
      const raw = await res.text()
      let data: { user?: User; error?: string } = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = {}
      }
      if (res.ok && data.user) {
        commitUser(data.user)
        toast.success('Profile updated!')
        return true
      } else {
        toast.error(data.error || `Profile update failed (${res.status})`)
        return false
      }
    } catch {
      toast.error('Network error')
      return false
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, optimisticUpdateBalance, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
