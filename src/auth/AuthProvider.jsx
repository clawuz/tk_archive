import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setUserProfile(null)
        setLoading(false)
        return
      }

      // Firestore security rules already enforce the domain allowlist, but
      // checking here too means a disallowed account gets signed straight
      // back out with a clear message instead of sitting on a Firestore
      // permission error.
      if (!isAllowedDomain(firebaseUser.email)) {
        setDomainError(true)
        await signOut(auth)
        setUser(null)
        setUserProfile(null)
        setLoading(false)
        return
      }

      setDomainError(false)
      setUser(firebaseUser)

      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        // requestAccess (the self-serve provisioning function) always
        // creates this doc in the same call as the Auth account, so a
        // missing doc here means something else created the account —
        // default to the lowest-privilege role rather than failing closed.
        setUserProfile(snap.exists() ? snap.data() : { role: 'viewer', department: null })
      } catch (err) {
        console.error('Kullanıcı profili yüklenemedi:', err)
        setUserProfile({ role: 'viewer', department: null })
      }

      setLoading(false)
    })

    return unsubscribe
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
