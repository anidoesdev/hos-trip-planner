import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-white hover:bg-ink-soft active:bg-ink shadow-sm disabled:bg-ink/60 disabled:cursor-not-allowed',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-ink/40 hover:bg-paper disabled:opacity-50',
  ghost: 'text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, ...rest }: ButtonProps) {
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-[15px] gap-2' }
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors whitespace-nowrap select-none',
        sizes[size],
        BUTTON_STYLES[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>}
        <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function ComplianceBadge({ ok, compact = false, title }: { ok: boolean; compact?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full font-medium',
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
      )}
    >
      {ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
      {ok ? 'HOS compliant' : 'HOS violation'}
    </span>
  )
}
