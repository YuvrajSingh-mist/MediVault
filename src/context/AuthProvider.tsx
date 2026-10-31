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
import { useProfiles } from '../lib/data'
import type { PatientOption, UserProfile } from '../types'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  patients: PatientOption[]
  /** Whose data is on screen - your own, or a patient who invited you. */
  activeUserId: string
  setActiveUserId: (uid: string) => void
  isCaregiverView: boolean
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
  const [activeUserId, setActiveUserIdState] = useState('')

  // 1. Who is signed in?
  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setAuthResolved(true)
      if (!next) {
        setProfile(null)
        setActiveUserIdState('')
      }
    })
  }, [])

  // 2. Make sure a profile document exists (idempotent, idempotency on purpose).
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

  // 3. Live profile (caregiver links and preferences change while signed in).
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

  // 4. Patients this account looks after.
  const caregiverOf = profile?.caregiverOf || []
  const patients = useProfiles(caregiverOf)

  // 5. Default to "me", and fall back if a caregiver link is revoked.
  useEffect(() => {
    if (!user) return
    setActiveUserIdState((current) => {
      if (!current) return user.uid
      const valid = current === user.uid || patients.some((patient) => patient.uid === current)
      return valid ? current : user.uid
    })
  }, [user, patients])

  const setActiveUserId = useCallback((uid: string) => setActiveUserIdState(uid), [])

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
    setActiveUserIdState('')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      patients,
      activeUserId: activeUserId || user?.uid || '',
      setActiveUserId,
      isCaregiverView: Boolean(user && activeUserId && activeUserId !== user.uid),
      loading: !authResolved || (Boolean(user) && !profile && !error),
      error,
      refresh,
      signOutUser,
    }),
    [user, profile, patients, activeUserId, setActiveUserId, authResolved, error, refresh, signOutUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
