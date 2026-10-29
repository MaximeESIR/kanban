import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ArrowUpRight, Folder, X, LoaderCircle } from 'lucide-react'

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark" aria-hidden="true">
        a<span>.</span>
      </span>
      <span>
        atelier<span className="brand-period">.</span>
      </span>
    </span>
  )
}

export function Spinner() {
  return <LoaderCircle size={18} className="spin" aria-label="Chargement" />
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
  busy = false,
}: {
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    document.body.classList.add('modal-open')
    return () => {
      dialog.close()
      document.body.classList.remove('modal-open')
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          const r = e.currentTarget.getBoundingClientRect()
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose()
        }
      }}
    >
      <div className="modal-header">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={id}>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <Folder size={27} strokeWidth={1.5} />}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ProjectIcon({
  color,
  size = 'normal',
}: {
  color: string
  size?: 'normal' | 'large' | 'small'
}) {
  return (
    <span className={`project-icon ${color} ${size}`}>
      <Folder size={size === 'large' ? 26 : size === 'small' ? 16 : 22} strokeWidth={1.7} />
    </span>
  )
}

export function Arrow() {
  return <ArrowUpRight size={20} aria-hidden="true" />
}
