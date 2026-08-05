import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { isAllowedDomain } from './domainCheck'

export default function ArchiveLoginPage({ domainError }) {
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
      background: 'linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 50%, #16213e 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Animated background orbs */}
      <div style={{
        position: 'absolute',
        top: '10%',
        left: '5%',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(100, 200, 255, 0.15) 0%, transparent 70%)',
        filter: 'blur(60px)',
        animation: 'float 20s infinite ease-in-out',
      }} />

      <div style={{
        position: 'absolute',
        bottom: '10%',
        right: '5%',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255, 100, 150, 0.1) 0%, transparent 70%)',
        filter: 'blur(50px)',
        animation: 'float 25s infinite ease-in-out reverse',
      }} />

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(30px); }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
      `}</style>

      {/* Main container */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        maxWidth: 480,
        padding: '0 24px',
        animation: 'fadeInUp 0.8s ease-out',
      }}>

        {/* Logo + Brand */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: 56,
          textAlign: 'center',
        }}>
          <div style={{
            width: 120,
            height: 120,
            background: 'linear-gradient(135deg, #6ECFFF 0%, #FF7B54 100%)',
            borderRadius: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 56,
            fontWeight: 700,
            color: '#fff',
            marginBottom: 32,
            boxShadow: '0 20px 60px rgba(110, 207, 255, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
          }}>
            📦
          </div>

          <div style={{ textAlign: 'center' }}>
            <h1 style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.5px',
            }}>
              TK <span style={{ background: 'linear-gradient(135deg, #6ECFFF 0%, #FF7B54 100%)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Archive</span>
            </h1>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {(domainError || error) && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(255,60,60,0.1) 0%, rgba(255,60,60,0.05) 100%)',
              border: '1px solid rgba(255,100,100,0.3)',
              borderRadius: 12,
              padding: '12px 16px',
              fontSize: 13,
              color: '#ff8888',
              lineHeight: 1.5,
              backdropFilter: 'blur(10px)',
              animation: 'fadeInUp 0.3s ease-out',
            }}>
              {domainError ? 'Bu e-posta adresiyle giriş yapamazsınız.' : error}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 12, color: '#a0a0b0', marginBottom: 8, display: 'block', fontWeight: 500 }}>
              E-posta
            </label>
            <input
              type="email"
              placeholder="ad@tribalistanbul.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              required
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 16px',
                background: focusedField === 'email'
                  ? 'rgba(110, 207, 255, 0.08)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: `2px solid ${focusedField === 'email' ? 'rgba(110, 207, 255, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: 12,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                fontFamily: 'inherit',
                backdropFilter: 'blur(10px)',
              }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 12, color: '#a0a0b0', marginBottom: 8, display: 'block', fontWeight: 500 }}>
              Şifre
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              required
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 16px',
                background: focusedField === 'password'
                  ? 'rgba(110, 207, 255, 0.08)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: `2px solid ${focusedField === 'password' ? 'rgba(110, 207, 255, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: 12,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                fontFamily: 'inherit',
                backdropFilter: 'blur(10px)',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              padding: '12px 20px',
              borderRadius: 12,
              background: loading
                ? 'rgba(110, 207, 255, 0.3)'
                : 'linear-gradient(135deg, #6ECFFF 0%, #FF7B54 100%)',
              color: '#fff',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.02em',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              fontFamily: 'inherit',
              boxShadow: loading ? 'none' : '0 10px 30px rgba(110, 207, 255, 0.3)',
              transform: loading ? 'scale(1)' : 'scale(1)',
              backdropFilter: 'blur(10px)',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'scale(1.02)'
                e.currentTarget.style.boxShadow = '0 15px 40px rgba(110, 207, 255, 0.4)'
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = '0 10px 30px rgba(110, 207, 255, 0.3)'
              }
            }}
          >
            {loading ? '⏳ Giriş yapılıyor...' : '🚀 Giriş Yap'}
          </button>
        </form>

        {/* Footer note */}
        <p style={{
          textAlign: 'center',
          marginTop: 40,
          fontSize: 12,
          color: '#606070',
          letterSpacing: '0.02em',
          fontWeight: 400,
        }}>
          TK Archive
        </p>
      </div>
    </div>
  )
}
