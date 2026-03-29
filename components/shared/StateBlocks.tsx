import type { ReactNode } from "react";

type LoadingStateListProps = {
  count?: number;
  containerClassName?: string;
  itemClassName?: string;
  itemKeyPrefix?: string;
  renderItem?: (index: number) => ReactNode;
};

export function LoadingStateList({
  count = 3,
  containerClassName = "grid gap-3",
  itemClassName = "h-36 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]",
  itemKeyPrefix = "state-skeleton",
  renderItem,
}: LoadingStateListProps) {
  return (
    <div className={containerClassName}>
      {Array.from({ length: count }).map((_, index) =>
        renderItem ? (
          <div key={`${itemKeyPrefix}-${index}`}>{renderItem(index)}</div>
        ) : (
          <div key={`${itemKeyPrefix}-${index}`} className={itemClassName} />
        )
      )}
    </div>
  );
}

type EmptyStateCardProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  dashed?: boolean;
  centered?: boolean;
};

export function EmptyStateCard({
  title,
  description,
  action,
  className = "",
  titleClassName = "",
  descriptionClassName = "",
  dashed = false,
  centered = true,
}: EmptyStateCardProps) {
  return (
    <div
      className={`rounded-2xl border bg-[color:var(--surface)] p-6 shadow-[0_8px_22px_rgba(2,8,23,0.06)] ${
        dashed ? "border-dashed border-[color:var(--surface-border)]" : "border-[color:var(--surface-border)]"
      } ${centered ? "text-center" : ""} ${className}`}
    >
      <p className={`text-lg font-semibold text-[color:var(--foreground)] ${titleClassName}`}>{title}</p>
      {description ? (
        <p className={`mt-2 text-sm text-[color:var(--muted-foreground)] ${descriptionClassName}`}>{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type ErrorStateCardProps = {
  title: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  titleClassName?: string;
  messageClassName?: string;
};

export function ErrorStateCard({
  title,
  message,
  onRetry,
  retryLabel = "Retry",
  className = "",
  titleClassName = "",
  messageClassName = "",
}: ErrorStateCardProps) {
  return (
    <div
      className={`rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-[color:var(--foreground)] ${className}`}
    >
      <p className={`text-lg font-bold ${titleClassName}`}>{title}</p>
      {message ? (
        <p className={`mt-2 text-sm text-[color:var(--muted-foreground)] ${messageClassName}`}>{message}</p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-secondary mt-4">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
