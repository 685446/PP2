import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import type { ReactNode } from "react";

type TeamDisplay = {
  name: string;
  shortName?: string | null;
  crestUrl: string | null;
};

type CountChipProps = {
  count: number;
  srLabel?: string;
};

type MatchActivityCardProps = {
  href: string;
  ariaLabel: string;
  leagueLabel: string;
  statusLabel: string;
  timeLabel: string;
  homeTeam: TeamDisplay;
  awayTeam: TeamDisplay;
  homeScore: number | null;
  awayScore: number | null;
  headline: string;
  count?: number | null;
  className?: string;
};

type DiscussionActivityCardProps = {
  href: string;
  ariaLabel: string;
  headerLeft: ReactNode;
  timeLabel: string;
  relation?: ReactNode;
  title: string;
  summary: string;
  footerLeft: ReactNode;
  count?: number | null;
  className?: string;
  titleClassName?: string;
  summaryClassName?: string;
};

export function CountChip({ count, srLabel = "posts" }: CountChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2 py-0.5 text-xs font-semibold text-[color:var(--muted-foreground)]">
      <MessagesSquare className="h-3.5 w-3.5 text-sky-500/80" />
      <span>{count}</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

export function TeamCrest({
  name,
  shortName,
  crestUrl,
  className,
}: TeamDisplay & { className?: string }) {
  if (!crestUrl) {
    const fallback = (shortName || name).slice(0, 3).toUpperCase();
    return (
      <span
        className={`inline-flex items-center justify-center rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-sm font-bold tracking-wide text-[color:var(--foreground)] ${
          className ?? ""
        }`}
      >
        {fallback}
      </span>
    );
  }

  return <img src={crestUrl} alt={`${name} crest`} className={className} />;
}

export function MatchActivityCard({
  href,
  ariaLabel,
  leagueLabel,
  statusLabel,
  timeLabel,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  headline,
  count,
  className,
}: MatchActivityCardProps) {
  return (
    <Link
      href={href}
      className={`group block rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)] transition hover:border-sky-400/45 hover:bg-[color:var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface)] ${
        className ?? ""
      }`}
      aria-label={ariaLabel}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
          {leagueLabel}
        </p>
        <div className="inline-flex items-center gap-2">
          <span className="rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
            {statusLabel}
          </span>
          <span className="text-xs text-[color:var(--muted-foreground)]">{timeLabel}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamCrest
            name={homeTeam.name}
            shortName={homeTeam.shortName}
            crestUrl={homeTeam.crestUrl}
            className="h-16 w-16 object-contain"
          />
          <p className="text-sm font-medium text-[color:var(--muted-foreground)]">
            {homeTeam.shortName || homeTeam.name}
          </p>
        </div>

        <p className="text-5xl font-black tracking-tight text-[color:var(--foreground)]">
          {homeScore ?? "-"} - {awayScore ?? "-"}
        </p>

        <div className="flex flex-col items-center gap-2 text-center">
          <TeamCrest
            name={awayTeam.name}
            shortName={awayTeam.shortName}
            crestUrl={awayTeam.crestUrl}
            className="h-16 w-16 object-contain"
          />
          <p className="text-sm font-medium text-[color:var(--muted-foreground)]">
            {awayTeam.shortName || awayTeam.name}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-lg font-semibold text-[color:var(--foreground)]">{headline}</p>
        {typeof count === "number" ? <CountChip count={count} /> : null}
      </div>
    </Link>
  );
}

export function DiscussionActivityCard({
  href,
  ariaLabel,
  headerLeft,
  timeLabel,
  relation,
  title,
  summary,
  footerLeft,
  count,
  className,
  titleClassName,
  summaryClassName,
}: DiscussionActivityCardProps) {
  return (
    <Link
      href={href}
      className={`group block rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_8px_22px_rgba(2,8,23,0.06)] transition hover:border-sky-400/45 hover:bg-[color:var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface)] ${
        className ?? ""
      }`}
      aria-label={ariaLabel}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">{headerLeft}</div>
        <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">{timeLabel}</span>
      </div>

      {relation ? <div className="mt-2">{relation}</div> : null}

      <h2 className={`mt-3 text-lg font-semibold text-[color:var(--foreground)] ${titleClassName ?? ""}`}>
        {title}
      </h2>
      <p className={`mt-2 text-sm text-[color:var(--muted-foreground)] ${summaryClassName ?? ""}`}>{summary}</p>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-medium text-[color:var(--muted-foreground)]">
        <div className="min-w-0 flex-1">{footerLeft}</div>
        {typeof count === "number" ? <CountChip count={count} /> : null}
      </div>
    </Link>
  );
}
