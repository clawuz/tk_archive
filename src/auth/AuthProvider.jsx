import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, signInAnonymously } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { isAllowedDomain } from './domainCheck'

const AuthContext = createContext({
  user: null,
  userProfile: null,
  loading: true,
  domainError: false,
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [domainError, setDomainError] = useState(false)

  useEffect(() => {
    // TEST MODE: allow access without login. Role is hardcoded to
    // 'super_admin' — the highest tier, so every permission-gated feature
    // (copyright editing, and the scan-triggering panel, which is
    // super_admin-only since it can touch the whole archive and trigger
    // real cost) can be exercised during development. Must be replaced by
    // real Firebase Auth + Firestore user roles before production — see
    // ArchiveLoginPage / LoginPage.
    setUserProfile({ role: 'super_admin', department: null })
    setUser({ uid: 'test-user', email: 'test@tribalistanbul.com' })
    setLoading(false)
  }, [])

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, domainError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
