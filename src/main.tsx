import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal">
          <h1>Un petit contretemps.</h1>
          <p>L’application n’a pas pu s’afficher. Rechargez la page pour réessayer.</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </main>
      )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {window.top === window.self ? (
        <App />
      ) : (
        <main className="fatal">
          <h1>Votre atelier, dans son propre onglet.</h1>
          <p>Ouvrez directement l’application pour accéder à votre espace.</p>
          <a className="button primary" href={window.location.href} target="_top">
            Ouvrir Atelier
          </a>
        </main>
      )}
    </ErrorBoundary>
  </React.StrictMode>,
)
