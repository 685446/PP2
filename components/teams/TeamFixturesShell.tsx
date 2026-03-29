"use client";

import Link from "next/link";
import { ArrowLeft, CalendarDays, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TeamRecord = {
  id: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
  venue: string;
  updatedAt: string;
};

type MatchTeam = {
  id: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
};

type MatchRecord = {
  id: number;
  utcDate: string;
  status: string;
  matchWeek: number | null;
  homeScore: number | null;
  awayScore: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
};

type TeamFixturesShellProps = {
  teamId: string;
};

type LoadState = "loading" | "ready" | "error";

function getCurrentSeasonLabel(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

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

function formatDate(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TeamFixturesShell({ teamId }: TeamFixturesShellProps) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamRecord | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      setErrorMessage(null);

      try {
        const season = getCurrentSeasonLabel();
        const [teamRes, matchesRes] = await Promise.all([
          fetch(`/api/teams/${encodeURIComponent(teamId)}`, { cache: "no-store" }),
          fetch(`/api/matches?teamId=${encodeURIComponent(teamId)}&season=${encodeURIComponent(season)}`, {
            cache: "no-store",
          }),
        ]);

        const [teamPayload, matchesPayload] = await Promise.all([
          teamRes.json().catch(() => ({})),
          matchesRes.json().catch(() => ({})),
        ]);

        if (!teamRes.ok) {
          throw new Error((teamPayload as { error?: string }).error || "Failed to load team.");
        }
        if (!matchesRes.ok) {
          throw new Error((matchesPayload as { error?: string }).error || "Failed to load fixtures.");
        }

        const fixtureRows = Array.isArray((matchesPayload as { data?: MatchRecord[] }).data)
          ? ((matchesPayload as { data?: MatchRecord[] }).data as MatchRecord[])
          : [];

        if (!cancelled) {
          setTeam(teamPayload as TeamRecord);
          setMatches(
            [...fixtureRows].sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
          );
          setState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setState("error");
          setErrorMessage(error instanceof Error ? error.message : "Failed to load fixtures.");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const rows = useMemo(() => {
    if (!team) return [];
    return matches.map((match) => {
      const isHome = match.homeTeamId === team.id;
      const opponent = isHome ? match.awayTeam : match.homeTeam;
      const venue = isHome ? "H" : "A";
      const hasScore = match.homeScore !== null && match.awayScore !== null;
      let outcome: "W" | "D" | "L" | null = null;

      if (isFinished(match.status) && hasScore) {
        const teamGoals = isHome ? match.homeScore! : match.awayScore!;
        const opponentGoals = isHome ? match.awayScore! : match.homeScore!;

        if (teamGoals > opponentGoals) {
          outcome = "W";
        } else if (teamGoals < opponentGoals) {
          outcome = "L";
        } else {
          outcome = "D";
        }
      }

      return {
        id: match.id,
        utcDate: match.utcDate,
        week: match.matchWeek,
        venue,
        opponent,
        status: match.status,
        outcome,
        score:
          hasScore
            ? `${match.homeScore}-${match.awayScore}`
            : null,
      };
    });
  }, [matches, team]);

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link href={`/teams/${teamId}`} className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Team
        </Link>
        <Link href="/matches" className="btn-secondary">
          Open Match Center
        </Link>
      </div>

      {state === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={`fixtures-skeleton-${idx}`}
              className="h-14 animate-pulse rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]"
            />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">
          <p className="font-semibold">Could not load fixture list</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
        </div>
      )}

      {state === "ready" && team && (
        <>
          <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_10px_24px_rgba(2,8,23,0.08)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {team.crestUrl ? (
                  <img src={team.crestUrl} alt={`${team.name} crest`} className="h-12 w-12 object-contain" />
                ) : (
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
                    <Shield className="h-6 w-6 text-[color:var(--muted-foreground)]" />
                  </span>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
                    Fixture List
                  </p>
                  <h1 className="mt-1 text-2xl font-bold text-[color:var(--foreground)]">{team.name}</h1>
                </div>
              </div>
              <p className="text-xs text-[color:var(--muted-foreground)]">Compact season view ({getCurrentSeasonLabel()})</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]">
            <div className="grid grid-cols-[80px_minmax(0,1fr)_44px_72px_74px] border-b border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
              <span>Date</span>
              <span>Opponent</span>
              <span>H/A</span>
              <span>GW</span>
              <span className="text-right">Result</span>
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-semibold text-[color:var(--foreground)]">No fixtures available.</p>
              </div>
            ) : (
              rows.map((row) => (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/matches/${row.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/matches/${row.id}`);
                    }
                  }}
                  className="grid cursor-pointer grid-cols-[80px_minmax(0,1fr)_44px_72px_74px] items-center gap-2 border-b border-[color:var(--surface-border)] px-3 py-2.5 text-sm transition hover:bg-[color:var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-sky-400/55 focus:ring-inset last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[color:var(--foreground)]">{formatDate(row.utcDate)}</p>
                    <p className="text-xs text-[color:var(--muted-foreground)]">{formatTime(row.utcDate)}</p>
                  </div>

                  <div className="flex min-w-0 items-center gap-2">
                    {row.opponent.crestUrl ? (
                      <img
                        src={row.opponent.crestUrl}
                        alt={`${row.opponent.name} crest`}
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                    ) : (
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[9px] font-bold text-[color:var(--muted-foreground)]">
                        {(row.opponent.shortName || row.opponent.name).slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <Link
                      href={`/teams/${row.opponent.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="truncate font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline"
                    >
                      {row.opponent.name}
                    </Link>
                  </div>

                  <span className="text-center font-semibold text-[color:var(--foreground)]">{row.venue}</span>
                  <span className="text-center text-[color:var(--muted-foreground)]">{row.week ?? "-"}</span>
                  <div className="flex items-center justify-end">
                    {row.outcome && row.score ? (
                      <span
                        className={`inline-flex min-h-7 min-w-[56px] items-center justify-center rounded-md px-2 text-center text-sm font-extrabold tracking-tight ${
                          row.outcome === "W"
                            ? "bg-emerald-600 text-white"
                            : row.outcome === "L"
                              ? "bg-rose-600 text-white"
                              : "bg-slate-500 text-white"
                        }`}
                        aria-label={
                          row.outcome === "W"
                            ? `Win ${row.score}`
                            : row.outcome === "L"
                              ? `Loss ${row.score}`
                              : `Draw ${row.score}`
                        }
                        title={
                          row.outcome === "W"
                            ? "Win"
                            : row.outcome === "L"
                              ? "Loss"
                              : "Draw"
                        }
                      >
                        {row.score}
                      </span>
                    ) : (
                      <span className="text-right font-semibold text-[color:var(--foreground)]">
                        {row.score || statusLabel(row.status)}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--muted-foreground)]">
            <p className="inline-flex items-center gap-2 font-semibold text-[color:var(--foreground)]">
              <CalendarDays className="h-4 w-4 text-sky-500" />
              Full team schedule view
            </p>
            <p className="mt-1">
              This compact page is built for scanning all fixtures quickly without switching gameweeks.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
