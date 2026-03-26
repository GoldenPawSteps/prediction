'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react'
import toast from 'react-hot-toast'

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
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  optimisticUpdateBalance: (amount: number) => () => void
  updateProfile: (fields: { username?: string; bio?: string }) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const logoutInProgressRef = useRef(false)

  const refreshUser = useCallback(async () => {
    if (logoutInProgressRef.current) {
      return
    }

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
        setUser(data)
        return
      }

      // Retry once on auth failures to avoid brief session flicker caused by
      // transient cookie propagation/race conditions.
      if (res.status === 401 || res.status === 403) {
        await new Promise((resolve) => window.setTimeout(resolve, 150))
        const retry = await fetch('/api/auth/me', { cache: 'no-store' })
        if (retry.ok) {
          const data = await retry.json()
          setUser(data)
          return
        }

        setUser(null)
        return
      }

      // Keep the current user on non-auth errors (e.g. 5xx/network edge cases).
    } catch {
      // Do not clear auth state on transient network failures.
    }
  }, [])

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
    // Keep auth-dependent UI (like balance) in sync when background events resolve markets.
    const intervalId = window.setInterval(() => {
      void refreshUser()
    }, 30000)

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
        setUser(data.user)
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
        setUser(data.user)
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

  const logout = async () => {
    if (logoutInProgressRef.current) {
      return
    }

    logoutInProgressRef.current = true
    setUser(null)
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    // Keep refresh blocked briefly so cookie invalidation can settle before
    // background visibility/interval refreshes run.
    window.setTimeout(() => {
      logoutInProgressRef.current = false
    }, 300)
    toast.success('Logged out')
  }

  const optimisticUpdateBalance = (amount: number) => {
    const previousUser = user
    if (user) {
      setUser({ ...user, balance: user.balance - amount })
    }
    // Verify in background (don't block)
    refreshUser().catch(() => {
      if (previousUser) setUser(previousUser)
    })
    // Return rollback function
    return () => {
      if (previousUser) setUser(previousUser)
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
        setUser(data.user)
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
