"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Flag,
  MessageSquare,
  Shield,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  homeScore: number | null;
  awayScore: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
};

type ThreadRecord = {
  id: number;
  title: string;
  body: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: string;
  _count: {
    posts: number;
  };
};

type StandingRecord = {
  season: string;
  position: number;
  playedGames: number;
  points: number;
  goalDifference: number;
  team: {
    id: number;
    name: string;
    shortName: string;
    crestUrl: string | null;
  };
};

type TeamPlaceholderShellProps = {
  teamId: string;
};

type LoadState = "loading" | "ready" | "error";
type TeamResult = "W" | "D" | "L";
type TeamFormEntry = {
  matchId: number;
  result: TeamResult;
  opponent: MatchTeam;
};

function getCurrentSeasonLabel(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

function formatRelativeTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "recently";

  const diffMs = date.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60000);
  const absMins = Math.abs(diffMins);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMins < 60) return formatter.format(diffMins, "minute");
  const diffHours = Math.round(diffMins / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function formatKickoff(utcDate: string) {
  const date = new Date(utcDate);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isFinishedStatus(status: string) {
  return status === "FINISHED" || status === "AWARDED";
}

function TeamHeaderSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6">
      <div className="h-4 w-20 rounded bg-[color:var(--surface-elevated)]" />
      <div className="mt-3 h-8 w-64 rounded bg-[color:var(--surface-elevated)]" />
      <div className="mt-4 h-4 w-44 rounded bg-[color:var(--surface-elevated)]" />
    </div>
  );
}

export default function TeamPlaceholderShell({ teamId }: TeamPlaceholderShellProps) {
  const router = useRouter();
  const [team, setTeam] = useState<TeamRecord | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [teamMatches, setTeamMatches] = useState<MatchRecord[]>([]);
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [standingSnapshot, setStandingSnapshot] = useState<StandingRecord | null>(null);
  const [standingRows, setStandingRows] = useState<StandingRecord[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesError, setModulesError] = useState<string | null>(null);

  const loadTeamModules = useCallback(async (resolvedTeamId: number) => {
    setModulesLoading(true);
    setModulesError(null);

    try {
      const season = getCurrentSeasonLabel();
      const [matchesRes, threadsRes, standingsRes] = await Promise.all([
        fetch(`/api/matches?teamId=${resolvedTeamId}&season=${encodeURIComponent(season)}`, {
          cache: "no-store",
        }),
        fetch(`/api/threads?teamId=${resolvedTeamId}&limit=5`, { cache: "no-store" }),
        fetch(`/api/standings?season=${encodeURIComponent(season)}`, { cache: "no-store" }),
      ]);

      const [matchesPayload, threadsPayload, standingsPayload] = await Promise.all([
        matchesRes.json().catch(() => ({})),
        threadsRes.json().catch(() => ({})),
        standingsRes.json().catch(() => ({})),
      ]);

      if (matchesRes.ok) {
        const data = Array.isArray((matchesPayload as { data?: MatchRecord[] }).data)
          ? ((matchesPayload as { data?: MatchRecord[] }).data as MatchRecord[])
          : [];
        const sorted = [...data].sort(
          (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
        );
        setTeamMatches(sorted);
      } else {
        setTeamMatches([]);
      }

      if (threadsRes.ok) {
        const data = Array.isArray((threadsPayload as { threads?: ThreadRecord[] }).threads)
          ? ((threadsPayload as { threads?: ThreadRecord[] }).threads as ThreadRecord[])
          : [];
        setThreads(data);
      } else {
        setThreads([]);
      }

      if (standingsRes.ok) {
        const data = Array.isArray((standingsPayload as { data?: StandingRecord[] }).data)
          ? ((standingsPayload as { data?: StandingRecord[] }).data as StandingRecord[])
          : [];
        const sorted = [...data].sort((a, b) => a.position - b.position);
        setStandingRows(sorted);
        setStandingSnapshot(data.find((row) => row.team.id === resolvedTeamId) || null);
      } else {
        setStandingRows([]);
        setStandingSnapshot(null);
      }

      if (!matchesRes.ok || !threadsRes.ok || !standingsRes.ok) {
        setModulesError("Some team widgets could not be fully loaded.");
      }
    } catch {
      setModulesError("Could not load team widgets right now.");
      setTeamMatches([]);
      setThreads([]);
      setStandingRows([]);
      setStandingSnapshot(null);
    } finally {
      setModulesLoading(false);
    }
  }, []);

  const loadTeamPage = useCallback(async () => {
    setState("loading");
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as TeamRecord & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load team.");
      }

      setTeam(payload);
      setState("ready");
      void loadTeamModules(payload.id);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load team.");
    }
  }, [loadTeamModules, teamId]);

  useEffect(() => {
    void loadTeamPage();
  }, [loadTeamPage]);

  const nextMatch = useMemo(() => {
    if (teamMatches.length === 0) return null;
    return teamMatches.find((match) => !isFinishedStatus(match.status)) || null;
  }, [teamMatches]);

  const recentForm = useMemo<TeamFormEntry[]>(() => {
    if (!team || teamMatches.length === 0) return [];
    const now = Date.now();

    const completed = [...teamMatches]
      .filter((match) => {
        const kickoffTs = new Date(match.utcDate).getTime();
        return isFinishedStatus(match.status) || kickoffTs < now;
      })
      .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());

    const formEntries: TeamFormEntry[] = [];
    for (const match of completed) {
      const isHome = match.homeTeamId === team.id;
      const isAway = match.awayTeamId === team.id;
      if (!isHome && !isAway) continue;
      if (match.homeScore === null || match.awayScore === null) continue;

      const teamGoals = isHome ? match.homeScore : match.awayScore;
      const opponentGoals = isHome ? match.awayScore : match.homeScore;
      const result: TeamResult =
        teamGoals > opponentGoals ? "W" : teamGoals < opponentGoals ? "L" : "D";
      const opponent = isHome ? match.awayTeam : match.homeTeam;

      formEntries.push({
        matchId: match.id,
        result,
        opponent,
      });

      if (formEntries.length === 5) break;
    }

    return formEntries;
  }, [team, teamMatches]);

  const standingWindow = useMemo(() => {
    if (!standingSnapshot || standingRows.length === 0) return [];

    const currentIndex = standingRows.findIndex(
      (row) => row.team.id === standingSnapshot.team.id
    );
    if (currentIndex < 0) return [];

    const start = Math.max(0, currentIndex - 3);
    const end = Math.min(standingRows.length, currentIndex + 4);
    return standingRows.slice(start, end);
  }, [standingRows, standingSnapshot]);

  return (
    <section className="mx-auto w-full max-w-[1120px] max-w-full overflow-x-clip space-y-5 px-3 sm:px-4 xl:px-0">
      <Link href="/teams" className="btn-secondary inline-flex max-w-full items-center gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back to Teams
      </Link>

      {state === "loading" && <TeamHeaderSkeleton />}

      {state === "error" && (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/12 p-5 text-rose-100">
          <p className="font-semibold">Could not load team page</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
          <button type="button" onClick={() => void loadTeamPage()} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      )}

      {state === "ready" && team && (
        <>
          <div className="relative max-w-full overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_12px_28px_rgba(2,8,23,0.1)] sm:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_8%_0%,rgba(56,189,248,0.14),transparent_58%),radial-gradient(120%_90%_at_100%_0%,rgba(16,185,129,0.1),transparent_62%)]" />
            <div className="relative flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                {team.crestUrl ? (
                  <img
                    src={team.crestUrl}
                    alt={`${team.name} crest`}
                    className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16"
                  />
                ) : (
                  <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] sm:h-16 sm:w-16">
                    <Shield className="h-7 w-7 text-[color:var(--muted-foreground)]" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
                    Team
                  </p>
                  <h1 className="mt-1 text-3xl font-bold leading-[0.95] text-[color:var(--foreground)] [overflow-wrap:anywhere] sm:text-5xl">
                    {team.name}
                  </h1>
                  <p className="mt-2 text-sm text-[color:var(--muted-foreground)] [overflow-wrap:anywhere]">
                    {team.shortName} - {team.venue}
                  </p>
                </div>
              </div>
              <p className="text-xs text-[color:var(--muted-foreground)] sm:text-right">
                Last synced {new Date(team.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                    <CalendarDays className="h-5 w-5" />
                    Fixtures
                  </h2>
                  <Link href={`/teams/${team.id}/fixtures`} className="text-xs font-semibold text-sky-400 hover:text-sky-300">
                    Full Fixtures
                  </Link>
                </div>

                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
                  {nextMatch ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/matches/${nextMatch.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/matches/${nextMatch.id}`);
                        }
                      }}
                      className="cursor-pointer rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 transition hover:border-sky-400/45 hover:bg-[color:var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-sky-400/55 focus:ring-offset-2 focus:ring-offset-[color:var(--surface-elevated)]"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                          Next Match
                        </p>
                        <p className="text-xs text-[color:var(--muted-foreground)]">
                          {formatKickoff(nextMatch.utcDate)}
                        </p>
                      </div>

                      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex min-w-0 flex-col items-center gap-2 text-center">
                          {nextMatch.homeTeam.crestUrl ? (
                            <img
                              src={nextMatch.homeTeam.crestUrl}
                              alt={`${nextMatch.homeTeam.name} crest`}
                              className="h-14 w-14 object-contain"
                            />
                          ) : (
                            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
                              <Shield className="h-6 w-6 text-[color:var(--muted-foreground)]" />
                            </div>
                          )}
                          <p className="max-w-full text-sm font-semibold text-[color:var(--foreground)] [overflow-wrap:anywhere]">
                            <Link
                              href={`/teams/${nextMatch.homeTeam.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="underline-offset-2 transition hover:text-sky-400 hover:underline"
                            >
                              {nextMatch.homeTeam.shortName || nextMatch.homeTeam.name}
                            </Link>
                          </p>
                        </div>

                        <div className="text-center">
                          <p className="text-3xl font-black tracking-tight text-[color:var(--foreground)]">
                            {isFinishedStatus(nextMatch.status)
                              ? `${nextMatch.homeScore ?? "-"} - ${nextMatch.awayScore ?? "-"}`
                              : "vs"}
                          </p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                            {nextMatch.status === "IN_PLAY"
                              ? "Live"
                              : isFinishedStatus(nextMatch.status)
                                ? "FT"
                                : "Kickoff"}
                          </p>
                        </div>

                        <div className="flex min-w-0 flex-col items-center gap-2 text-center">
                          {nextMatch.awayTeam.crestUrl ? (
                            <img
                              src={nextMatch.awayTeam.crestUrl}
                              alt={`${nextMatch.awayTeam.name} crest`}
                              className="h-14 w-14 object-contain"
                            />
                          ) : (
                            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
                              <Shield className="h-6 w-6 text-[color:var(--muted-foreground)]" />
                            </div>
                          )}
                          <p className="max-w-full text-sm font-semibold text-[color:var(--foreground)] [overflow-wrap:anywhere]">
                            <Link
                              href={`/teams/${nextMatch.awayTeam.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="underline-offset-2 transition hover:text-sky-400 hover:underline"
                            >
                              {nextMatch.awayTeam.shortName || nextMatch.awayTeam.name}
                            </Link>
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
                      <p className="text-sm text-[color:var(--muted-foreground)]">
                        No upcoming fixture scheduled.
                      </p>
                    </div>
                  )}

                  <div className="mt-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-3">
                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                        Form (last 5)
                      </p>
                      <p className="text-xs text-[color:var(--muted-foreground)]">Most recent first</p>
                    </div>

                    {recentForm.length === 0 ? (
                      <p className="text-sm text-[color:var(--muted-foreground)]">
                        Not enough completed matches to show form yet.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {recentForm.map((entry) => (
                          <div
                            key={`form-${entry.matchId}`}
                            className="min-w-0 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2 py-2 text-center"
                          >
                            <span
                              className={`inline-flex min-w-[30px] items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold ${
                                entry.result === "W"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : entry.result === "L"
                                    ? "bg-rose-500/20 text-rose-300"
                                    : "bg-slate-500/20 text-slate-200"
                              }`}
                            >
                              {entry.result}
                            </span>
                            <div className="mt-2 flex justify-center">
                              {entry.opponent.crestUrl ? (
                                <img
                                  src={entry.opponent.crestUrl}
                                  alt={`${entry.opponent.name} crest`}
                                  className="h-8 w-8 object-contain"
                                />
                              ) : (
                                <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[10px] font-bold text-[color:var(--muted-foreground)]">
                                  {(entry.opponent.shortName || entry.opponent.name).slice(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                              <Link
                                href={`/teams/${entry.opponent.id}`}
                                className="underline-offset-2 transition hover:text-sky-400 hover:underline"
                              >
                                {entry.opponent.shortName || entry.opponent.name}
                              </Link>
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                    <MessageSquare className="h-5 w-5" />
                    Team Threads
                  </h2>
                  <Link href={`/communities/${team.id}`} className="text-xs font-semibold text-sky-400 hover:text-sky-300">
                    Open Team Community
                  </Link>
                </div>

                <div className="space-y-2">
                  {threads.length === 0 && (
                    <p className="text-sm text-[color:var(--muted-foreground)]">No team threads yet.</p>
                  )}

                  {threads.map((thread) => (
                    <Link
                      key={thread.id}
                      href={`/threads/${thread.id}`}
                      className="block rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 transition hover:border-sky-400/50 hover:bg-[color:var(--surface)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">{thread.title}</p>
                        <span className="text-xs text-[color:var(--muted-foreground)]">
                          {formatRelativeTime(thread.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-[color:var(--muted-foreground)]">{thread.body}</p>
                      <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">{thread._count.posts} posts</p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            <aside className="min-w-0 space-y-4">
              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                  <Trophy className="h-5 w-5" />
                  Table Snapshot
                </h2>
                {standingSnapshot ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-[color:var(--muted-foreground)]">Current season standing</p>
                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
                      <p className="text-sm font-semibold text-[color:var(--foreground)]">
                        Position #{standingSnapshot.position}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                        {standingSnapshot.points} pts | GD {standingSnapshot.goalDifference > 0 ? `+${standingSnapshot.goalDifference}` : standingSnapshot.goalDifference}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        {standingSnapshot.playedGames} matches played ({standingSnapshot.season})
                      </p>
                    </div>

                    {standingWindow.length > 0 && (
                      <div className="overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
                        <div className="grid grid-cols-[34px_minmax(0,1fr)_44px] border-b border-[color:var(--surface-border)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
                          <span>#</span>
                          <span>Club</span>
                          <span className="text-right">Pts</span>
                        </div>
                        {standingWindow.map((row) => {
                          const isCurrentTeam = row.team.id === standingSnapshot.team.id;
                          return (
                            <div
                              key={`standing-window-${row.team.id}`}
                              className={`grid grid-cols-[34px_minmax(0,1fr)_44px] items-center gap-2 border-b border-[color:var(--surface-border)] px-3 py-2 text-sm last:border-b-0 ${
                                isCurrentTeam
                                  ? "bg-sky-500/12 text-[color:var(--foreground)]"
                                  : "text-[color:var(--muted-foreground)]"
                              }`}
                            >
                              <span className={`font-semibold ${isCurrentTeam ? "text-[color:var(--foreground)]" : ""}`}>
                                {row.position}
                              </span>
                              <span className="flex min-w-0 items-center gap-2">
                                {row.team.crestUrl ? (
                                  <img
                                    src={row.team.crestUrl}
                                    alt={`${row.team.name} crest`}
                                    className="h-4.5 w-4.5 shrink-0 object-contain"
                                  />
                                ) : (
                                  <span className="inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[9px] font-bold">
                                    {row.team.shortName.slice(0, 2).toUpperCase()}
                                  </span>
                                )}
                                <span className={`truncate ${isCurrentTeam ? "font-semibold text-[color:var(--foreground)]" : ""}`}>
                                  <Link
                                    href={`/teams/${row.team.id}`}
                                    className="underline-offset-2 transition hover:text-sky-400 hover:underline"
                                  >
                                    {row.team.shortName || row.team.name}
                                  </Link>
                                </span>
                              </span>
                              <span className={`text-right font-semibold ${isCurrentTeam ? "text-[color:var(--foreground)]" : ""}`}>
                                {row.points}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">Standing snapshot not available yet.</p>
                )}
              </div>

              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
                <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
                  <Flag className="h-5 w-5" />
                  Quick Actions
                </h2>
                <div className="mt-3 space-y-2">
                  <Link href={`/teams/${team.id}/fixtures`} className="btn-secondary w-full justify-between">
                    All Fixtures
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
                  <Clock3 className="h-4 w-4" />
                  Live data modules enabled
                </p>
                <p className="mt-1">
                  Fixtures, standings snapshot, and team threads are now connected to backend data.
                </p>
                {modulesError && (
                  <p className="mt-2 text-amber-300">{modulesError}</p>
                )}
                {modulesLoading && !modulesError && (
                  <p className="mt-2 text-[color:var(--muted-foreground)]">Updating team widgets...</p>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
