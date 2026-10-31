import { useEffect, useState } from 'react'

interface InstallEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: string }>
}
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [help, setHelp] = useState(false)
  const [dark, setDark] = useState(() => {
    try {
      return (
        localStorage.getItem('atelier-theme') === 'dark' ||
        (!localStorage.getItem('atelier-theme') &&
          matchMedia('(prefers-color-scheme: dark)').matches)
      )
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem('atelier-theme', dark ? 'dark' : 'light')
    } catch {}
  }, [dark])
  const [update, setUpdate] = useState(false)
  useEffect(() => {
    const listener = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', listener)
    if (import.meta.env.PROD && 'serviceWorker' in navigator)
      void navigator.serviceWorker
        .register(new URL('sw.js', document.baseURI).href)
        .then((r) => {
          const refreshUpdate = () => setUpdate(Boolean(r.waiting && r.active))
          refreshUpdate()
          r.addEventListener('updatefound', () => {
            r.installing?.addEventListener('statechange', refreshUpdate)
          })
        })
        .catch(() => setHelp(true))
    return () => window.removeEventListener('beforeinstallprompt', listener)
  }, [])
  return (
    <div className="install-bar">
      <button className="text-button" onClick={() => setDark(!dark)}>
        {dark ? 'Thème clair' : 'Thème sombre'}
      </button>{' '}
      ·
      <button
        className="text-button"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt()
            setPrompt(null)
          } else setHelp(!help)
        }}
      >
        Installer l’application
      </button>
      {help && (
        <p>
          Sur iPhone : Safari → Partager → Sur l’écran d’accueil. Sur Android : menu du navigateur →
          Installer l’application. Une première ouverture en ligne prépare le mode hors connexion.
        </p>
      )}
      {update && (
        <p>
          Une mise à jour est prête. Fermez tous les onglets Atelier puis rouvrez l’application
          après enregistrement de vos modifications.
        </p>
      )}
    </div>
  )
}
