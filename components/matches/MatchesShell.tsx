"use client";

import Image from "next/image";
import Link from "next/link";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Filter, Shield, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

type MatchesPayload = {
  data?: MatchRecord[];
  error?: string;
};

type LoadState = "loading" | "ready" | "error";

function getCurrentSeasonLabel(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

function toLocalDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMatchDayLabel(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatKickoffTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "TBD";
  return `${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

function statusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "FINISHED") return "FT";
  if (normalized === "IN_PLAY") return "LIVE";
  if (normalized === "PAUSED") return "HT";
  if (normalized === "SCHEDULED" || normalized === "TIMED") return "Scheduled";
  return normalized;
}

function isUpcomingLike(status: string) {
  const normalized = status.toUpperCase();
  return normalized === "SCHEDULED" || normalized === "TIMED" || normalized === "IN_PLAY" || normalized === "PAUSED";
}

function displayTeamLabel(team: MatchTeam) {
  return team.shortName?.trim() || team.name;
}

function MatchCard({ match }: { match: MatchRecord }) {
  const router = useRouter();
  const showScore = match.homeScore !== null && match.awayScore !== null;
  const label = statusLabel(match.status);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/matches/${match.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(`/matches/${match.id}`);
        }
      }}
      className="cursor-pointer rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_8px_20px_rgba(2,8,23,0.06)] transition hover:border-sky-400/45 hover:bg-[color:var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-sky-400/55 focus:ring-offset-2 focus:ring-offset-[color:var(--background)]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 sm:gap-3">
        <div className="flex min-w-0 flex-col items-center gap-2 text-center">
          {match.homeTeam.crestUrl ? (
            <Image
              src={match.homeTeam.crestUrl}
              alt={`${match.homeTeam.name} crest`}
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 object-contain"
            />
          ) : (
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
              <Shield className="h-5 w-5 text-[color:var(--muted-foreground)]" />
            </span>
          )}

          <div className="min-w-0 max-w-full">
            <Link
              href={`/teams/${match.homeTeam.id}`}
              onClick={(event) => event.stopPropagation()}
              className="block truncate text-sm font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline sm:hidden"
            >
              {displayTeamLabel(match.homeTeam)}
            </Link>
            <Link
              href={`/teams/${match.homeTeam.id}`}
              onClick={(event) => event.stopPropagation()}
              className="hidden truncate text-sm font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline sm:block"
            >
              {match.homeTeam.name}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[color:var(--muted-foreground)] sm:hidden">
              {match.homeTeam.name}
            </p>
            <p className="hidden truncate text-xs text-[color:var(--muted-foreground)] sm:block">
              {match.homeTeam.shortName}
            </p>
          </div>
        </div>

        <div className="min-w-[6.25rem] text-center sm:min-w-[7.25rem]">
          <p className="text-xl font-black tracking-tight text-[color:var(--foreground)] sm:text-2xl">
            {showScore ? `${match.homeScore} - ${match.awayScore}` : formatKickoffTime(match.utcDate)}
          </p>
          <p
            className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              label === "LIVE"
                ? "text-rose-400"
                : "text-[color:var(--muted-foreground)]"
            }`}
          >
            {label}
          </p>
        </div>

        <div className="flex min-w-0 flex-col items-center gap-2 text-center">
          {match.awayTeam.crestUrl ? (
            <Image
              src={match.awayTeam.crestUrl}
              alt={`${match.awayTeam.name} crest`}
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 object-contain"
            />
          ) : (
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
              <Shield className="h-5 w-5 text-[color:var(--muted-foreground)]" />
            </span>
          )}

          <div className="min-w-0 max-w-full">
            <Link
              href={`/teams/${match.awayTeam.id}`}
              onClick={(event) => event.stopPropagation()}
              className="block truncate text-sm font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline sm:hidden"
            >
              {displayTeamLabel(match.awayTeam)}
            </Link>
            <Link
              href={`/teams/${match.awayTeam.id}`}
              onClick={(event) => event.stopPropagation()}
              className="hidden truncate text-sm font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline sm:block"
            >
              {match.awayTeam.name}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[color:var(--muted-foreground)] sm:hidden">
              {match.awayTeam.name}
            </p>
            <p className="hidden truncate text-xs text-[color:var(--muted-foreground)] sm:block">
              {match.awayTeam.shortName}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[color:var(--surface-border)] pt-3">
        <p className="min-w-0 text-xs text-[color:var(--muted-foreground)]">
          Matchweek {match.matchWeek ?? "-"}
        </p>
        <p className="shrink-0 text-xs font-semibold text-sky-400">Open details</p>
      </div>
    </article>
  );
}

export default function MatchesShell() {
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");
  const [isWeekMenuOpen, setIsWeekMenuOpen] = useState(false);
  const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);
  const weekMenuRef = useRef<HTMLDivElement | null>(null);
  const teamMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMatches() {
      setState("loading");
      setErrorMessage(null);

      try {
        const season = getCurrentSeasonLabel();
        const response = await fetch(`/api/matches?season=${encodeURIComponent(season)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as MatchesPayload;
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load matches.");
        }

        const data = Array.isArray(payload.data) ? payload.data : [];
        const sorted = [...data].sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
        const weeks = Array.from(
          new Set(sorted.map((match) => match.matchWeek).filter((week): week is number => Number.isInteger(week)))
        ).sort((a, b) => a - b);

        const now = Date.now();
        const next = sorted.find((match) => {
          const ts = new Date(match.utcDate).getTime();
          return (ts >= now || isUpcomingLike(match.status)) && Number.isInteger(match.matchWeek);
        });

        const defaultWeek = next?.matchWeek ?? weeks[0] ?? null;

        if (!cancelled) {
          setMatches(sorted);
          setSelectedWeek(defaultWeek);
          setState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setState("error");
          setErrorMessage(error instanceof Error ? error.message : "Failed to load matches.");
        }
      }
    }

    void loadMatches();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableWeeks = useMemo(
    () =>
      Array.from(
        new Set(matches.map((match) => match.matchWeek).filter((week): week is number => Number.isInteger(week)))
      ).sort((a, b) => a - b),
    [matches]
  );

  const teamOptions = useMemo(() => {
    const byId = new Map<number, { id: number; name: string }>();
    for (const match of matches) {
      byId.set(match.homeTeam.id, { id: match.homeTeam.id, name: match.homeTeam.name });
      byId.set(match.awayTeam.id, { id: match.awayTeam.id, name: match.awayTeam.name });
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [matches]);

  const weekIndex = useMemo(
    () => (selectedWeek === null ? -1 : availableWeeks.indexOf(selectedWeek)),
    [availableWeeks, selectedWeek]
  );

  const canGoPrev = weekIndex > 0;
  const canGoNext = weekIndex >= 0 && weekIndex < availableWeeks.length - 1;

  const filteredMatches = useMemo(() => {
    if (selectedWeek === null) return [];
    const teamId = selectedTeamId === "all" ? null : Number(selectedTeamId);

    return matches.filter((match) => {
      if (match.matchWeek !== selectedWeek) return false;
      if (!teamId) return true;
      return match.homeTeamId === teamId || match.awayTeamId === teamId;
    });
  }, [matches, selectedTeamId, selectedWeek]);

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, MatchRecord[]>();
    const labels = new Map<string, string>();

    for (const match of filteredMatches) {
      const date = new Date(match.utcDate);
      const key = Number.isNaN(date.getTime()) ? `unknown-${match.id}` : toLocalDayKey(date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(match);
      if (!labels.has(key)) labels.set(key, formatMatchDayLabel(match.utcDate));
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, dayMatches]) => ({
        key,
        label: labels.get(key) || "Unknown date",
        matches: dayMatches.sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()),
      }));
  }, [filteredMatches]);

  const selectedTeam = useMemo(() => {
    if (selectedTeamId === "all") return null;
    const numericId = Number(selectedTeamId);
    if (!Number.isInteger(numericId)) return null;
    return teamOptions.find((team) => team.id === numericId) || null;
  }, [selectedTeamId, teamOptions]);

  useEffect(() => {
    if (!isWeekMenuOpen && !isTeamMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (weekMenuRef.current && !weekMenuRef.current.contains(target)) {
        setIsWeekMenuOpen(false);
      }

      if (teamMenuRef.current && !teamMenuRef.current.contains(target)) {
        setIsTeamMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsWeekMenuOpen(false);
        setIsTeamMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isTeamMenuOpen, isWeekMenuOpen]);

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-4">
      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_12px_26px_rgba(2,8,23,0.08)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
              Fixtures
            </p>
            <h1 className="mt-1 text-3xl font-bold text-[color:var(--foreground)]">Premier League Matches</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!canGoPrev) return;
                setSelectedWeek(availableWeeks[weekIndex - 1]);
              }}
              disabled={!canGoPrev || state !== "ready"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Previous gameweek"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div ref={weekMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsWeekMenuOpen((open) => !open)}
                disabled={state !== "ready" || availableWeeks.length === 0}
                aria-expanded={isWeekMenuOpen}
                aria-haspopup="listbox"
                className="inline-flex h-10 min-w-[160px] items-center justify-between rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 text-sm text-[color:var(--foreground)] shadow-[0_6px_14px_rgba(2,8,23,0.05)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <CalendarDays className="h-4 w-4 shrink-0 text-sky-500" />
                  <span className="text-[color:var(--muted-foreground)]">Week</span>
                  <span className="truncate font-semibold text-[color:var(--foreground)]">
                    {selectedWeek ?? "-"}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-[color:var(--muted-foreground)] transition-transform ${
                    isWeekMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isWeekMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-[180px] overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_24px_rgba(2,8,23,0.16)]">
                  <div className="max-h-72 overflow-auto p-1.5">
                    {availableWeeks.map((week) => {
                      const isSelected = selectedWeek === week;
                      return (
                        <button
                          key={week}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setSelectedWeek(week);
                            setIsWeekMenuOpen(false);
                          }}
                          className={`inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
                            isSelected
                              ? "bg-sky-500/20 font-semibold text-sky-400"
                              : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                          }`}
                        >
                          Matchweek {week}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (!canGoNext) return;
                setSelectedWeek(availableWeeks[weekIndex + 1]);
              }}
              disabled={!canGoNext || state !== "ready"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Next gameweek"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <div ref={teamMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsTeamMenuOpen((open) => !open)}
                disabled={state !== "ready"}
                aria-expanded={isTeamMenuOpen}
                aria-haspopup="listbox"
                className="inline-flex h-10 w-[220px] items-center justify-between rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 text-sm text-[color:var(--foreground)] shadow-[0_6px_14px_rgba(2,8,23,0.05)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Filter className="h-4 w-4 shrink-0 text-sky-500" />
                  <span className="text-[color:var(--muted-foreground)]">Team</span>
                  <span className="max-w-[120px] truncate font-semibold text-[color:var(--foreground)]">
                    {selectedTeam?.name ?? "All teams"}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-[color:var(--muted-foreground)] transition-transform ${
                    isTeamMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isTeamMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-[260px] overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_24px_rgba(2,8,23,0.16)]">
                  <div className="max-h-72 overflow-auto p-1.5">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedTeamId === "all"}
                      onClick={() => {
                        setSelectedTeamId("all");
                        setIsTeamMenuOpen(false);
                      }}
                      className={`inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
                        selectedTeamId === "all"
                          ? "bg-sky-500/20 font-semibold text-sky-400"
                          : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                      }`}
                    >
                      All teams
                    </button>
                    {teamOptions.map((team) => {
                      const value = String(team.id);
                      const isSelected = selectedTeamId === value;
                      return (
                        <button
                          key={team.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setSelectedTeamId(value);
                            setIsTeamMenuOpen(false);
                          }}
                          className={`inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
                            isSelected
                              ? "bg-sky-500/20 font-semibold text-sky-400"
                              : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                          }`}
                        >
                          <span className="truncate">{team.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {state === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={`matches-skeleton-${idx}`}
              className="h-24 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]"
            />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">
          <p className="font-semibold">Could not load matches</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
        </div>
      )}

      {state === "ready" && groupedByDate.length === 0 && (
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 text-center">
          <p className="text-lg font-semibold text-[color:var(--foreground)]">No matches in this view</p>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            Try another gameweek or clear the team filter.
          </p>
        </div>
      )}

      {state === "ready" && groupedByDate.length > 0 && (
        <div className="space-y-4">
          {groupedByDate.map((group) => (
            <section key={group.key} className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)]">
                <CalendarDays className="h-3.5 w-3.5 text-sky-500" />
                {group.label}
              </div>

              <div className="space-y-2">
                {group.matches.map((match) => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {state === "ready" && availableWeeks.length > 0 && selectedTeam && (
          <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--muted-foreground)] shadow-[0_8px_20px_rgba(2,8,23,0.06)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 font-semibold text-[color:var(--foreground)]">
                  <Trophy className="h-4 w-4 text-sky-500" />
                  Viewing {selectedTeam.name} in Gameweek {selectedWeek ?? "-"}
                </p>
                <p className="mt-1">
                  Open the compact full-team fixture page to scan the entire season in one place.
                </p>
              </div>
              <Link href={`/teams/${selectedTeam.id}/fixtures`} className="btn-secondary self-start sm:self-auto">
                Open Full Fixture List
              </Link>
            </div>
          </div>
      )}
    </section>
  );
}
