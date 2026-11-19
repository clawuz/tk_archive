import { useState } from 'react'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase'
import { isAllowedDomain } from './domainCheck'
import GlobeLoader from '../components/dam/GlobeLoader'
import tribalWordmarkBlack from '../assets/tribal-wordmark-black.png'

const NAVY = '#0A1E42'

const inputClass =
  'w-full box-border px-4 py-3 bg-white/40 backdrop-blur-[1px] border border-white/70 rounded-lg text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/70 transition'

export default function LoginPage({ domainError }) {
  const [mode, setMode] = useState('login') // 'login' | 'request'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!isAllowedDomain(email)) {
      setError('Yalnızca @tribalistanbul.com, @twist.ddb.com ve @thy.com adresleriyle giriş yapabilirsiniz.')
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

  // First-time visitors and anyone who's forgotten their password land here
  // via the same flow: request an account (a no-op if one already exists),
  // then let Firebase Auth's own hosted email handle actually delivering a
  // "set your password" link — no custom mail sending on our side.
  async function handleRequestAccess(e) {
    e.preventDefault()
    setError('')
    if (!isAllowedDomain(email)) {
      setError('Yalnızca @tribalistanbul.com, @twist.ddb.com ve @thy.com adresleriyle hesap oluşturulabilir.')
      return
    }
    setLoading(true)
    try {
      const requestAccess = httpsCallable(functions, 'requestAccess')
      await requestAccess({ email })
      await sendPasswordResetEmail(auth, email)
      setRequestSent(true)
    } catch {
      setError('Bir şeyler ters gitti. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError('')
    setRequestSent(false)
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-6">
      {/* Same THY globe animation as the archive header, scaled up to fill
          the whole page — the login screen's only "content" behind the card,
          rather than a separate static background. */}
      <div className="absolute inset-0">
        <GlobeLoader />
      </div>

      <div className="relative z-10 w-full max-w-[400px] py-12">
        <div className="flex flex-col items-center mb-8">
          <img src={tribalWordmarkBlack} alt="Tribal Worldwide Istanbul" style={{ height: 32, width: 'auto' }} />
          <h1 className="font-bold text-3xl mt-5 tracking-tight" style={{ color: NAVY }}>
            TK Archive
          </h1>
          <p className="text-sm mt-1.5" style={{ color: NAVY, opacity: 0.55 }}>
            Dijital Varlık Yönetim Sistemi
          </p>
        </div>

        <div className="bg-white/15 backdrop-blur-[1px] rounded-2xl shadow-xl border border-white/40 p-6">
          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              {(domainError || error) && (
                <div className="p-3 bg-red-50/60 backdrop-blur-[1px] border border-red-200/70 rounded-lg text-xs text-red-800 leading-relaxed">
                  {domainError ? 'Bu e-posta adresiyle giriş yapamazsınız.' : error}
                </div>
              )}

              <input
                type="email"
                placeholder="ad@tribalistanbul.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
              />
              <input
                type="password"
                placeholder="Şifre"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputClass}
              />

              <button
                type="submit"
                disabled={loading}
                className="mt-1 py-3 rounded-lg bg-[#acaeb2bf] backdrop-blur-[1px] hover:bg-[#acaeb2] disabled:opacity-50 text-white font-semibold text-sm transition"
              >
                {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
              </button>

              <button
                type="button"
                onClick={() => switchMode('request')}
                className="mt-1 py-1 text-xs text-slate-500 hover:text-slate-700 hover:underline"
              >
                Şifreni mi unuttun veya ilk kez mi giriyorsun? Şifre al
              </button>
            </form>
          ) : requestSent ? (
            <div className="flex flex-col gap-4 text-center">
              <div className="p-3 bg-green-50/60 backdrop-blur-[1px] border border-green-200/70 rounded-lg text-xs text-green-800 leading-relaxed">
                {email} adresine bir bağlantı gönderdik. Gelen kutunu (ve spam klasörünü) kontrol edip şifreni oluştur.
              </div>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="py-1 text-xs text-slate-500 hover:text-slate-700 hover:underline"
              >
                Giriş ekranına dön
              </button>
            </div>
          ) : (
            <form onSubmit={handleRequestAccess} className="flex flex-col gap-3">
              <p className="text-xs text-slate-500 leading-relaxed">
                E-posta adresini gir, sana şifreni oluşturman için bir bağlantı gönderelim.
              </p>

              {error && (
                <div className="p-3 bg-red-50/60 backdrop-blur-[1px] border border-red-200/70 rounded-lg text-xs text-red-800 leading-relaxed">
                  {error}
                </div>
              )}

              <input
                type="email"
                placeholder="ad@tribalistanbul.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
              />

              <button
                type="submit"
                disabled={loading}
                className="mt-1 py-3 rounded-lg bg-[#acaeb2bf] backdrop-blur-[1px] hover:bg-[#acaeb2] disabled:opacity-50 text-white font-semibold text-sm transition"
              >
                {loading ? 'Gönderiliyor...' : 'Şifre Al'}
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="py-1 text-xs text-slate-500 hover:text-slate-700 hover:underline"
              >
                Giriş ekranına dön
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
