import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { isAllowedDomain } from './domainCheck'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [domainError, setDomainError] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (!isAllowedDomain(firebaseUser.email)) {
          await signOut(auth)
          setDomainError(true)
          setLoading(false)
          return
        }
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        setUserProfile(snap.exists() ? snap.data() : { role: 'pending', department: null })
        setUser(firebaseUser)
      } else {
        setUser(null)
        setUserProfile(null)
      }
      setLoading(false)
    })
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
