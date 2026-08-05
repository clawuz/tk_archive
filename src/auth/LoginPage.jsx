import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { isAllowedDomain } from './domainCheck'

const TribalLogo = () => (
  <img
    src="https://tribalistanbul.com/wp-content/themes/tribaltheme/assets/icons/logo.svg"
    alt="Tribal Worldwide Istanbul"
    style={{ width: 100, height: 'auto', display: 'block' }}
  />
)

export default function LoginPage({ domainError }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!isAllowedDomain(email)) {
      setError('Yalnızca @tribalistanbul.com ve @twist.ddb.com adresleriyle giriş yapabilirsiniz.')
      return
    }
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch {
      setError('E-posta veya şifre hatalı. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080808',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Subtle background grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      {/* Gold accent glow top-left */}
      <div style={{
        position: 'absolute', top: -200, left: -200,
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(247,212,23,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Orange accent glow bottom-right */}
      <div style={{
        position: 'absolute', bottom: -200, right: -200,
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,107,43,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 400,
        padding: '0 24px',
      }}>

        {/* Logo + Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 48 }}>
          <div style={{
            padding: '20px 24px 16px',
            background: '#fff',
            border: '1px solid #E8E8E8',
            borderRadius: 16,
            marginBottom: 28,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <TribalLogo />
          </div>

          <div style={{ textAlign: 'center' }}>
            <h1 style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '-0.3px',
            }}>
              İlham <span style={{ color: '#F7D417' }}>Arşivi</span>
            </h1>
            <p style={{
              margin: '8px 0 0',
              fontSize: 13,
              color: '#444',
              letterSpacing: '0.02em',
              lineHeight: 1.6,
            }}>
              Tribal Worldwide Istanbul'un ödüllü işleri<br />ve yaratıcı arşivi — yalnızca ekip üyelerine özel.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {(domainError || error) && (
            <div style={{
              background: 'rgba(255,60,60,0.08)',
              border: '1px solid rgba(255,60,60,0.2)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: '#ff6b6b',
              lineHeight: 1.5,
            }}>
              {domainError ? 'Bu e-posta adresiyle giriş yapamazsınız.' : error}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <input
              type="email"
              placeholder="ad@tribalistanbul.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              required
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 16px',
                background: '#0D0D0D',
                border: `1px solid ${focusedField === 'email' ? '#F7D417' : '#1E1E1E'}`,
                borderRadius: 10,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
                transition: 'border-color 0.2s',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <input
              type="password"
              placeholder="Şifre"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              required
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 16px',
                background: '#0D0D0D',
                border: `1px solid ${focusedField === 'password' ? '#F7D417' : '#1E1E1E'}`,
                borderRadius: 10,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
                transition: 'border-color 0.2s',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px',
              borderRadius: 10,
              background: loading ? '#1A1A1A' : '#F7D417',
              color: loading ? '#555' : '#0A0A0A',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.02em',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#ffe033' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#F7D417' }}
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        {/* Footer note */}
        <p style={{
          textAlign: 'center',
          marginTop: 32,
          fontSize: 11,
          color: '#2A2A2A',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Tribal Worldwide Istanbul · Dahili Platform
        </p>
      </div>
    </div>
  )
}
