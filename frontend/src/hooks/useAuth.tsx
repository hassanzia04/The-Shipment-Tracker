import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { authApi } from '@/api/auth'
import type { User } from '@/types'

interface AuthContext {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthContext | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, check if we have a valid session (cookie sent automatically).
  // A real 401 means no session; a network error / server hiccup does NOT —
  // retry briefly before giving up so a blip doesn't bounce users to login.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data } = await authApi.me()
          if (!cancelled) setUser(data)
          break
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 401 || status === 403) break // genuinely not logged in
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
      if (!cancelled) setLoading(false)
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [])

  async function login(email: string, password: string) {
    // Backend sets HttpOnly auth cookies and returns the user object
    const { data } = await authApi.login(email, password)
    setUser(data)
  }

  async function logout() {
    await authApi.logout()
    setUser(null)
  }

  async function refresh() {
    try {
      const { data } = await authApi.me()
      setUser(data)
    } catch { /* session gone — keep current state */ }
  }

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
