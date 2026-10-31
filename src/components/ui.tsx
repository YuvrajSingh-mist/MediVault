import {
  useEffect,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icons'

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/* --------------------------------- buttons -------------------------------- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'soft' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: IconName
  block?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        'btn',
        `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        block && 'btn-block',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  )
}

/* ---------------------------------- cards --------------------------------- */

export function Card({
  children,
  className,
  padded = false,
  style,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  style?: CSSProperties
}) {
  return (
    <div className={cx('card', padded && 'card-pad', className)} style={style}>
      {children}
    </div>
  )
}

export function CardHead({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>
      {actions}
    </div>
  )
}

/* ---------------------------------- forms --------------------------------- */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('select', className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('textarea', className)} {...rest} />
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="input-icon" style={{ minWidth: 210, flex: 1, maxWidth: 320 }}>
      <Icon name="search" size={16} />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || 'Search'}
        aria-label={placeholder || 'Search'}
      />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <div className="toggle-row">
      <div>
        <div className="label">{label}</div>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      <button
        type="button"
        className="switch"
        data-on={checked}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

/* --------------------------------- badges --------------------------------- */

type BadgeTone = 'default' | 'brand' | 'amber' | 'red' | 'blue' | 'violet'

export function Badge({
  children,
  tone = 'default',
  dot = false,
}: {
  children: ReactNode
  tone?: BadgeTone
  dot?: boolean
}) {
  return (
    <span className={cx('badge', tone !== 'default' && tone)}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  )
}

/* ---------------------------------- stats --------------------------------- */

export function Avatar({
  name,
  email,
  photoURL,
  size = 'md',
}: {
  name?: string
  email?: string
  photoURL?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const source = (name || email || 'MediVault').trim()
  const words = source.split(/[\s._-]+/).filter(Boolean)
  const label =
    words.length === 0
      ? 'MV'
      : words.length === 1
        ? words[0].slice(0, 2).toUpperCase()
        : `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()

  return (
    <span className={cx('avatar', size !== 'md' && size)} aria-hidden="true">
      {photoURL ? <img src={photoURL} alt="" referrerPolicy="no-referrer" /> : label}
    </span>
  )
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon: IconName
  tone?: 'brand' | 'amber' | 'red' | 'blue' | 'violet'
}) {
  return (
    <Card className="stat">
      <div className={cx('stat-icon', tone !== 'brand' && tone)}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub ? <div className="stat-sub">{sub}</div> : null}
      </div>
    </Card>
  )
}

/* -------------------------------- feedback -------------------------------- */

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} />
}

export function EmptyState({
  icon = 'file',
  title,
  message,
  action,
}: {
  icon?: IconName
  title: string
  message?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="icon">
        <Icon name={icon} size={20} />
      </div>
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {action ? <div className="action">{action}</div> : null}
    </div>
  )
}

/* ---------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{message}</div>
    </Modal>
  )
}

/* --------------------------------- headers -------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  )
}

export function AlertBox({
  tone = 'info',
  icon = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'warn'
  icon?: IconName
  children: ReactNode
}) {
  return (
    <div className={cx('alert-box', tone)}>
      <Icon name={icon} size={15} />
      <div>{children}</div>
    </div>
  )
}
