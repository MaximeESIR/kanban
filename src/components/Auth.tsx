import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Check, ShieldCheck } from 'lucide-react'
import { Brand, Spinner } from './ui'
import { configured, configError, demoEnabled, friendlyError, supabase } from '../lib/supabase'
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_STORAGE } from '../lib/demo'

export function Auth({
  onDemo,
  recovery,
  onRecovered,
}: {
  onDemo: () => void
  recovery: boolean
  onRecovered: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [show, setShow] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const demo = demoEnabled
  const unavailable = Boolean(configError || (!configured && !demo))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      if (unavailable) throw new Error(configError || 'La connexion n’est pas encore configurée.')
      if (recovery) {
        if (password !== confirmation)
          throw new Error('Les deux mots de passe ne correspondent pas.')
        if (password.length < 12)
          throw new Error('Choisissez un mot de passe d’au moins 12 caractères.')
        const result = await supabase!.auth.updateUser({ password })
        if (result.error) throw result.error
        onRecovered()
      } else if (forgot) {
        const redirect = new URL(window.location.pathname, window.location.origin)
        redirect.searchParams.set('recovery', '1')
        const result = await supabase!.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: redirect.toString(),
        })
        if (result.error) throw result.error
        setMessage(
          'Si cette adresse correspond à votre compte, un lien de réinitialisation vous a été envoyé. Ouvrez-le dans ce navigateur.',
        )
      } else if (demo) {
        if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD)
          throw new Error('Utilisez les identifiants de démonstration indiqués ci-dessous.')
        onDemo()
      } else {
        const result = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
        if (result.error) throw result.error
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Brand />
        <div className="auth-intro">
          <span className="eyebrow">
            <span className="tiny-line" /> VOTRE ESPACE PERSONNEL
          </span>
          <h1>
            Les idées prennent
            <br />
            leur place.
          </h1>
          <p>
            Un peu de clarté pour vos projets.
            <br />
            Un peu de liberté pour vos idées.
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="sketch-note">
              <div className="sketch-pin" />
              <span>Une idée à la fois.</span>
              <div className="sketch-line" />
              <div className="sketch-line short" />
              <span className="sketch-star">✳</span>
            </div>
            <div className="sketch-ticket">
              <span className="sketch-check">
                <Check size={17} />
              </span>
              <div>
                <strong>Faire de la place à l’essentiel</strong>
                <small>Un petit pas de plus.</small>
              </div>
            </div>
            <div className="sketch-dot dot-one" />
            <div className="sketch-dot dot-two" />
          </div>
        </div>
        <p className="auth-footer">Moins de bruit. Plus de place pour créer.</p>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="auth-lock">
            <LockKeyhole size={22} strokeWidth={1.5} />
          </span>
          <p className="eyebrow">{demo ? 'BIENVENUE DANS LA DÉMO' : 'BIENVENUE CHEZ VOUS'}</p>
          <h2>
            {recovery
              ? 'Un nouveau départ.'
              : forgot
                ? 'Mot de passe oublié ?'
                : 'Retrouvez votre atelier.'}
          </h2>
          <p className="auth-description">
            {recovery
              ? 'Choisissez votre nouveau mot de passe.'
              : forgot
                ? 'Recevez un lien pour retrouver votre espace.'
                : 'Vos projets et vos notes, au même endroit.'}
          </p>
          {unavailable ? (
            <div className="setup-notice">
              <ShieldCheck size={22} />
              <h3>Votre espace est prêt à être connecté.</h3>
              <p>
                {configError ||
                  'Configurez Supabase pour activer la connexion sécurisée. Les instructions se trouvent dans le README du projet.'}
              </p>
            </div>
          ) : (
            <form onSubmit={submit}>
              {!recovery && (
                <label className="field">
                  Adresse e-mail
                  <div className="input-icon">
                    <Mail size={17} />
                    <input
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="vous@exemple.fr"
                      required
                      autoFocus
                    />
                  </div>
                </label>
              )}
              {(!forgot || recovery) && (
                <label className="field">
                  {recovery ? 'Nouveau mot de passe' : 'Mot de passe'}
                  <div className="input-icon">
                    <LockKeyhole size={17} />
                    <input
                      type={show ? 'text' : 'password'}
                      autoComplete={recovery ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Votre mot de passe"
                      required
                      minLength={recovery ? 12 : 1}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShow(!show)}
                      aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {show ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
              )}
              {recovery && (
                <label className="field">
                  Confirmer le mot de passe
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    required
                    minLength={12}
                  />
                </label>
              )}
              {!demo && !recovery && !forgot && (
                <button
                  type="button"
                  className="text-button forgot"
                  onClick={() => {
                    setForgot(true)
                    setError('')
                  }}
                >
                  Mot de passe oublié ?
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="form-success" role="status">
                  {message}
                </p>
              )}
              <button className="button primary auth-submit" disabled={busy}>
                {busy ? (
                  <Spinner />
                ) : (
                  <>
                    {recovery
                      ? 'Enregistrer le mot de passe'
                      : forgot
                        ? 'Envoyer le lien'
                        : 'Se connecter'}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
              {forgot && (
                <button
                  type="button"
                  className="text-button back-login"
                  onClick={() => {
                    setForgot(false)
                    setMessage('')
                    setError('')
                  }}
                >
                  Revenir à la connexion
                </button>
              )}
            </form>
          )}
          {demo && (
            <div className="demo-login">
              <div>
                <span className="badge demo-badge">ACCÈS TEMPORAIRE</span>
                <p>
                  Identifiants publics de démonstration. Les données restent dans ce navigateur,
                  sans synchronisation entre appareils ni protection par mot de passe.
                </p>
              </div>
              <dl>
                <dt>E-mail</dt>
                <dd>{DEMO_EMAIL}</dd>
                <dt>Mot de passe</dt>
                <dd>{DEMO_PASSWORD}</dd>
              </dl>
              <div className="demo-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setEmail(DEMO_EMAIL)
                    setPassword(DEMO_PASSWORD)
                  }}
                >
                  Remplir les identifiants <ArrowRight size={14} />
                </button>
                <button
                  className="text-button muted"
                  onClick={() => {
                    try {
                      localStorage.removeItem(DEMO_STORAGE)
                      setMessage('Les données d’exemple seront recréées à la connexion.')
                    } catch {
                      setError('Le stockage local est indisponible.')
                    }
                  }}
                >
                  Réinitialiser la démo
                </button>
              </div>
            </div>
          )}
          {!demo && (
            <p className="private-caption">
              <ShieldCheck size={14} /> Un espace privé, accessible uniquement à votre compte.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
