import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Panel({
  id,
  title,
  icon,
  actions,
  className,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn('flex min-w-0 flex-col rounded-2xl border border-border bg-card shadow-sm', className)}
    >
      <header className="flex items-center justify-between gap-300 border-b border-border px-500 py-300">
        <h2
          id={`${id}-title`}
          className="flex items-center gap-200 font-semibold text-[length:var(--text-400)] leading-400 text-card-foreground"
        >
          {icon && <span className="text-brand-foreground">{icon}</span>}
          {title}
        </h2>
        {actions && <div className="flex items-center gap-200">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-500">{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-200 px-400 py-700 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="font-semibold text-[length:var(--text-300)]">{title}</p>
      {children && <p className="max-w-[360px] text-[length:var(--text-300)] text-muted-foreground">{children}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-200 rounded-xl border border-destructive bg-danger-soft px-300 py-200 text-[length:var(--text-300)] text-foreground"
    >
      <AlertTriangle aria-hidden className="mt-100-nudge icon-size-200 shrink-0 text-destructive" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-300" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-[44px] animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-[32px] items-center justify-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-200 rounded-lg px-400 py-200 font-semibold transition-colors',
        'text-[length:var(--text-300)] leading-300',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border bg-secondary text-secondary-foreground hover:bg-hover',
      )}
    >
      {children}
    </button>
  );
}
