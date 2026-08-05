import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { DAMDashboard } from './components/dam'
import LoginPage from './auth/LoginPage'
import './index.css'

function AppShell() {
  const { user, loading, domainError } = useAuth()

  if (loading) return (
    <div style={{ background: '#0A0A0A', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF6B2B', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 16 }}>
      Yükleniyor...
    </div>
  )

  if (!user) return <LoginPage domainError={domainError} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0A0A0A', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <main style={{ flex: 1 }}>
        <DAMDashboard />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
