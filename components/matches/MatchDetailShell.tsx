"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  MapPin,
  MessageSquare,
  Shield,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type MatchTeam = {
  id: number;
  name: string;
  crestUrl: string | null;
};

type MatchThreadSummary = {
  id: number;
  title: string;
};

type MatchRecord = {
  id: number;
  externalId: string;
  matchWeek: number | null;
  season: string;
  utcDate: string;
  status: string;
  venue: string | null;
  homeScore: number | null;
  awayScore: number | null;
  createdAt: string;
  updatedAt: string;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  thread: MatchThreadSummary | null;
};

type ThreadTag = {
  tag: {
    id: number;
    name: string;
  };
};

type MatchThreadRecord = {
  id: number;
  title: string;
  openAt: string;
  closedAt: string | null;
  createdAt: string;
  author: {
    id: number;
    username: string;
  };
  tags: ThreadTag[];
  _count: {
    posts: number;
  };
};

type LoadState = "loading" | "ready" | "error";

type MatchDetailShellProps = {
  matchId: string;
};

function statusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "FINISHED") return "FT";
  if (normalized === "IN_PLAY") return "LIVE";
  if (normalized === "PAUSED") return "HT";
  if (normalized === "SCHEDULED" || normalized === "TIMED") return "Scheduled";
  return normalized;
}

function isFinished(status: string) {
  const normalized = status.toUpperCase();
  return normalized === "FINISHED" || normalized === "AWARDED";
}

function formatKickoff(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "Unknown kickoff";
  return `${date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

function formatRelativeTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "recently";

  const diffMins = Math.round((date.getTime() - Date.now()) / 60000);
  const absMins = Math.abs(diffMins);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMins < 60) return formatter.format(diffMins, "minute");
  const diffHours = Math.round(diffMins / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function TeamCrest({
  team,
  className,
}: {
  team: MatchTeam;
  className: string;
}) {
  if (team.crestUrl) {
    return <Image src={team.crestUrl} alt={`${team.name} crest`} width={64} height={64} className={className} />;
  }

  return (
    <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
      <Shield className="h-6 w-6 text-[color:var(--muted-foreground)]" />
    </span>
  );
}

export default function MatchDetailShell({ matchId }: MatchDetailShellProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [thread, setThread] = useState<MatchThreadRecord | null>(null);
  const [threadWarning, setThreadWarning] = useState<string | null>(null);

  const loadMatchPage = useCallback(async () => {
    setState("loading");
    setErrorMessage(null);
    setThreadWarning(null);

    try {
      const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as MatchRecord & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load match.");
      }

      setMatch(payload);
      setState("ready");

      try {
        const threadRes = await fetch(`/api/matches/${encodeURIComponent(matchId)}/thread`, {
          cache: "no-store",
        });
        if (!threadRes.ok) {
          setThread(null);
          return;
        }

        const threadPayload = (await threadRes.json()) as MatchThreadRecord;
        setThread(threadPayload);
      } catch {
        setThread(null);
        setThreadWarning("Thread preview is temporarily unavailable.");
      }
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load match.");
    }
  }, [matchId]);

  useEffect(() => {
    void loadMatchPage();
  }, [loadMatchPage]);

  const scoreText = useMemo(() => {
    if (!match) return "-";
    if (match.homeScore !== null && match.awayScore !== null) {
      return `${match.homeScore} - ${match.awayScore}`;
    }
    return formatKickoff(match.utcDate);
  }, [match]);

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-5">
      <div className="flex flex-wrap gap-2">
        <Link href="/matches" className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Matches
        </Link>
      </div>

      {state === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={`match-detail-skeleton-${idx}`}
              className="h-28 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]"
            />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">
          <p className="font-semibold">Could not load match page</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
          <button type="button" onClick={() => void loadMatchPage()} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      )}

      {state === "ready" && match && (
        <>
          <div className="relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 shadow-[0_12px_28px_rgba(2,8,23,0.1)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_10%_0%,rgba(56,189,248,0.14),transparent_58%),radial-gradient(120%_90%_at_100%_0%,rgba(16,185,129,0.12),transparent_62%)]" />
            <div className="relative">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
                  Premier League Match
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                      statusLabel(match.status) === "LIVE"
                        ? "border-rose-400/50 bg-rose-500/15 text-rose-300"
                        : "border-sky-400/40 bg-sky-500/12 text-sky-300"
                    }`}
                  >
                    {statusLabel(match.status)}
                  </span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {formatRelativeTime(match.utcDate)}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <TeamCrest team={match.homeTeam} className="h-16 w-16 object-contain" />
                  <Link
                    href={`/teams/${match.homeTeam.id}`}
                    className="text-base font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline"
                  >
                    {match.homeTeam.name}
                  </Link>
                </div>

                <div className="text-center">
                  <p className="text-4xl font-black tracking-tight text-[color:var(--foreground)]">{scoreText}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                    {isFinished(match.status) ? "Full Time" : "Kickoff"}
                  </p>
                </div>

                <div className="flex flex-col items-center gap-2 text-center">
                  <TeamCrest team={match.awayTeam} className="h-16 w-16 object-contain" />
                  <Link
                    href={`/teams/${match.awayTeam.id}`}
                    className="text-base font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline"
                  >
                    {match.awayTeam.name}
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                  <CalendarDays className="h-5 w-5" />
                  Match Information
                </h2>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Season
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">{match.season}</p>
                  </div>
                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Matchweek
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      {match.matchWeek ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Kickoff
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      {formatKickoff(match.utcDate)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Venue
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      {match.venue || "Unknown venue"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                    <MessageSquare className="h-5 w-5" />
                    Match Thread
                  </h2>
                  {match.thread?.id && (
                    <Link href={`/threads/${match.thread.id}`} className="btn-secondary">
                      Open Thread
                    </Link>
                  )}
                </div>

                {thread ? (
                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
                    <p className="text-base font-semibold text-[color:var(--foreground)]">{thread.title}</p>
                    <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                      by {thread.author.username} - {thread._count.posts} posts
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      Opens {formatRelativeTime(thread.openAt)}
                      {thread.closedAt ? ` • Closes ${formatRelativeTime(thread.closedAt)}` : ""}
                    </p>
                    {thread.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {thread.tags.slice(0, 6).map((threadTag) => (
                          <span
                            key={`${thread.id}-${threadTag.tag.id}`}
                            className="inline-flex rounded-full border border-sky-400/35 bg-sky-500/12 px-2.5 py-1 text-[11px] font-semibold text-sky-300"
                          >
                            {threadTag.tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4 text-sm text-[color:var(--muted-foreground)]">
                    <p>No active match thread found for this fixture yet.</p>
                    {threadWarning && <p className="mt-2 text-amber-300">{threadWarning}</p>}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                  <Trophy className="h-5 w-5" />
                  Quick Actions
                </h2>
                <div className="mt-3 space-y-2">
                  <Link href={`/teams/${match.homeTeam.id}`} className="btn-secondary w-full justify-between">
                    {match.homeTeam.name}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <Link href={`/teams/${match.awayTeam.id}`} className="btn-secondary w-full justify-between">
                    {match.awayTeam.name}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <Link href="/matches" className="btn-secondary w-full justify-between">
                    Match Center
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <Link href="/standings" className="btn-secondary w-full justify-between">
                    League Table
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--muted-foreground)]">
                <p className="inline-flex items-center gap-2 font-semibold text-[color:var(--foreground)]">
                  <MapPin className="h-4 w-4" />
                  Match metadata synced
                </p>
                <p className="mt-1">
                  Last updated {formatRelativeTime(match.updatedAt)}.
                </p>
                <p className="mt-1">
                  External ID: {match.externalId}
                </p>
                <p className="mt-2 inline-flex items-center gap-2 text-xs">
                  <Clock3 className="h-3.5 w-3.5" />
                  Kickoff {formatRelativeTime(match.utcDate)}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
