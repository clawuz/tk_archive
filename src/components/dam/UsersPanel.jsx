import { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../firebase'
import { useAuth } from '../../auth/AuthProvider'
import { XIcon, PlusIcon, TrashIcon, UsersIcon, CheckIcon } from '../icons'

const ROLES = ['viewer', 'admin', 'super_admin']

export default function UsersPanel({ onClose }) {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState('viewer')
  const [adding, setAdding] = useState(false)
  const [busyUid, setBusyUid] = useState(null)
  const [newCredentials, setNewCredentials] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function loadUsers() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('email')))
      setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() })))
    } catch (err) {
      console.error('Kullanıcılar yüklenemedi:', err)
      setError('Kullanıcılar yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRoleChange(uid, role) {
    setError(null)
    setBusyUid(uid)
    try {
      await updateDoc(doc(db, 'users', uid), { role })
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, role } : u)))
    } catch (err) {
      console.error('Rol güncellenemedi:', err)
      setError('Rol güncellenemedi.')
    } finally {
      setBusyUid(null)
    }
  }

  async function handleAddUser(e) {
    e.preventDefault()
    setError(null)
    setNewCredentials(null)
    const email = newEmail.trim().toLowerCase()
    setAdding(true)
    try {
      const adminCreateUser = httpsCallable(functions, 'adminCreateUser')
      const res = await adminCreateUser({ email, role: newRole })
      // Corporate mail security scanners consume the password-reset link
      // before the recipient can click it (confirmed on twist.ddb.com), so
      // brand-new accounts get a temp password set directly instead of a
      // reset email — the backend only returns one when it actually created
      // a new account, not when it just updated an existing user's role.
      if (res.data?.tempPassword) {
        setNewCredentials({ email, password: res.data.tempPassword })
      }
      setNewEmail('')
      setNewRole('viewer')
      await loadUsers()
    } catch (err) {
      console.error('Kullanıcı eklenemedi:', err)
      setError(err.message || 'Kullanıcı eklenemedi.')
    } finally {
      setAdding(false)
    }
  }

  async function copyCredentials() {
    if (!newCredentials) return
    try {
      await navigator.clipboard.writeText(`${newCredentials.email} / ${newCredentials.password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Panoya kopyalanamadı:', err)
    }
  }

  async function handleDeleteUser(uid, email) {
    if (!window.confirm(`${email} adlı kullanıcıyı silmek istediğinize emin misiniz?`)) return
    setError(null)
    setBusyUid(uid)
    try {
      const adminDeleteUser = httpsCallable(functions, 'adminDeleteUser')
      await adminDeleteUser({ uid })
      setUsers((prev) => prev.filter((u) => u.uid !== uid))
    } catch (err) {
      console.error('Kullanıcı silinemedi:', err)
      setError(err.message || 'Kullanıcı silinemedi.')
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full sm:max-w-2xl sm:my-8 bg-white dark:bg-slate-800 sm:rounded-xl shadow-2xl min-h-screen sm:min-h-0 sm:max-h-[85vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <UsersIcon size={18} /> Kullanıcılar
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Shown once, right after creating a new account — mail-based
              password setup isn't reliable here (see handleAddUser), so this
              is the only place the temp password is ever surfaced. */}
          {newCredentials && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm space-y-2">
              <p className="text-blue-900 dark:text-blue-200 font-medium">
                Hesap oluşturuldu — bu bilgiyi kullanıcıya elden iletin (mail linki kurumsal filtrelerde takılabiliyor):
              </p>
              <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-800 rounded px-3 py-2 font-mono text-xs">
                <span className="truncate">{newCredentials.email} / {newCredentials.password}</span>
                <button
                  type="button"
                  onClick={copyCredentials}
                  className="shrink-0 flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {copied ? <><CheckIcon size={12} /> Kopyalandı</> : 'Kopyala'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setNewCredentials(null)}
                className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
              >
                Kapat
              </button>
            </div>
          )}

          {/* Add user — creates the account with the chosen role in one step
              (requestAccess, the self-serve version, always defaults to
              viewer); a temp password comes back instead of an email link. */}
          <form onSubmit={handleAddUser} className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">E-posta</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="ad@tribalistanbul.com"
                required
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Rol</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={adding}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
            >
              <PlusIcon size={14} /> {adding ? 'Ekleniyor...' : 'Ekle'}
            </button>
          </form>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
            {loading ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Yükleniyor...</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Henüz kullanıcı yok.</p>
            ) : (
              <div className="space-y-2">
                {users.map((u) => {
                  const isSelf = u.uid === user?.uid
                  return (
                    <div
                      key={u.uid}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <p className="min-w-0 flex-1 text-sm font-medium text-slate-900 dark:text-white truncate">
                        {u.email}{isSelf && <span className="text-slate-400 dark:text-slate-500 font-normal"> (siz)</span>}
                      </p>
                      <select
                        value={u.role || 'viewer'}
                        onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                        disabled={busyUid === u.uid || isSelf}
                        title={isSelf ? 'Kendi rolünüzü buradan değiştiremezsiniz' : undefined}
                        className="px-2 py-1 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u.uid, u.email)}
                        disabled={busyUid === u.uid || isSelf}
                        title={isSelf ? 'Kendi hesabınızı silemezsiniz' : 'Kullanıcıyı sil'}
                        className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
