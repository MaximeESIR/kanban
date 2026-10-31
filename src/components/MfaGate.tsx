import { useEffect, useState, type ReactNode } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { Brand, Spinner } from './ui'
export function MfaGate({
  children,
  onLogout,
}: {
  children: ReactNode
  onLogout: () => Promise<void>
}) {
  const [ready, setReady] = useState(false),
    [factor, setFactor] = useState(''),
    [qr, setQr] = useState(''),
    [secret, setSecret] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const check = async () => {
      try {
        const { data, error } = await supabase!.auth.mfa.getAuthenticatorAssuranceLevel()
        if (error) throw error
        if (!live) return
        setReady(data?.currentLevel === 'aal2')
        if (data?.currentLevel !== 'aal2') {
          const f = await supabase!.auth.mfa.listFactors()
          if (f.error) throw f.error
          if (live) setFactor(f.data.totp.find((x) => x.status === 'verified')?.id || '')
        }
      } catch (e) {
        if (live) setError(friendlyError(e))
      }
    }
    void check()
    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange(() => {
      setTimeout(() => void check(), 0)
    })
    return () => {
      live = false
      subscription.unsubscribe()
    }
  }, [])
  async function enroll() {
    setBusy(true)
    setError('')
    try {
      const factors = await supabase!.auth.mfa.listFactors()
      if (factors.error) throw factors.error
      for (const f of factors.data.all.filter(
        (x) => x.factor_type === 'totp' && x.status === 'unverified',
      )) {
        const r = await supabase!.auth.mfa.unenroll({ factorId: f.id })
        if (r.error) throw r.error
      }
      const r = await supabase!.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Atelier',
        issuer: 'Atelier',
      })
      if (r.error) throw r.error
      setFactor(r.data.id)
      setQr(r.data.totp.qr_code)
      setSecret(r.data.totp.secret)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    setBusy(true)
    setError('')
    try {
      const r = await supabase!.auth.mfa.challengeAndVerify({ factorId: factor, code })
      if (r.error) throw r.error
      setCode('')
      setSecret('')
      setQr('')
      setReady(true)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  if (ready) return <>{children}</>
  return (
    <main className="mfa-page">
      <Brand />
      <h1>Protégez votre atelier.</h1>
      <p>
        Un code de votre application d’authentification est nécessaire pour accéder aux données et
        au PC.
      </p>
      {!factor ? (
        <button className="button primary" disabled={busy} onClick={() => void enroll()}>
          Configurer la double authentification
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          {qr && (
            <>
              <img
                className="mfa-qr"
                src={qr.startsWith('data:') ? qr : `data:image/svg+xml,${encodeURIComponent(qr)}`}
                alt="QR code à scanner avec votre application d’authentification"
              />
              <details>
                <summary>Configuration manuelle</summary>
                <code>{secret}</code>
              </details>
              <p>Gardez une sauvegarde sécurisée de votre application d’authentification.</p>
            </>
          )}
          <label className="field">
            Code à six chiffres
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button className="button primary" disabled={busy || code.length !== 6}>
            {busy ? <Spinner /> : 'Vérifier'}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="text-button"
        onClick={() => void onLogout().catch((e) => setError(friendlyError(e)))}
      >
        Se déconnecter
      </button>
    </main>
  )
}
