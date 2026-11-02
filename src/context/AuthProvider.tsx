import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { api, errorMessage } from '../lib/api'
import { browserTimezone } from '../lib/format'
import type { UserProfile } from '../types'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  /** Whose data is on screen. One vault per account, so this is the signed-in uid. */
  activeUserId: string
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 1. Who is signed in?
  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setAuthResolved(true)
      if (!next) setProfile(null)
    })
  }, [])

  // 2. Make sure a profile document exists (idempotent, safe to call on every load).
  useEffect(() => {
    if (!user) return
    let cancelled = false
    api
      .ensureProfile({ timezone: browserTimezone(), displayName: user.displayName })
      .then(() => {
        if (!cancelled) setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // 3. Live profile (preferences change while signed in).
  useEffect(() => {
    if (!user) return
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile({ ...(snap.data() as UserProfile), uid: snap.id })
          setError(null)
        }
      },
      (err) => setError(errorMessage(err)),
    )
  }, [user])

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      await api.ensureProfile({ timezone: browserTimezone(), displayName: user.displayName })
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [user])

  const signOutUser = useCallback(async () => {
    await signOut(auth)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      activeUserId: user?.uid || '',
      loading: !authResolved || (Boolean(user) && !profile && !error),
      error,
      refresh,
      signOutUser,
    }),
    [user, profile, authResolved, error, refresh, signOutUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
