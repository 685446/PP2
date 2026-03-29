"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, ShieldAlert, Trophy } from "lucide-react";

type StandingTeam = {
  id: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
};

type StandingRow = {
  id: number;
  season: string;
  position: number;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalDifference: number;
  updatedAt: string;
  team: StandingTeam;
};

type StandingsPayload = {
  league?: string;
  data?: StandingRow[];
  error?: string;
};

type LoadStatus = "loading" | "ready" | "error";
const MIN_SEASON_START_YEAR = 2023; // 2023-24

function normalizeSeasonValue(season: string): number {
  const match = season.match(/^(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function toSeasonLabel(startYear: number): string {
  const nextYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${nextYear}`;
}

function getCurrentSeasonStartYear(now = new Date()): number {
  // EPL seasons roll over in summer; before July we are still in previous start year season.
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  return month >= 6 ? year : year - 1;
}

function formatRelativeTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "recently";

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const absMinutes = Math.abs(diffMinutes);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMinutes < 60) return formatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function getRowTone(position: number, total: number) {
  if (position <= 4) return "border-l-2 border-l-emerald-400/80";
  if (position === 5) return "border-l-2 border-l-sky-400/80";
  if (position >= Math.max(1, total - 2)) return "border-l-2 border-l-rose-400/80";
  return "border-l-2 border-l-transparent";
}

function StandingsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={`standings-skeleton-${index}`}
          className="animate-pulse rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3"
        >
          <div className="h-4 w-24 rounded bg-[color:var(--surface-elevated)]" />
          <div className="mt-3 h-4 w-3/4 rounded bg-[color:var(--surface-elevated)]" />
        </div>
      ))}
    </div>
  );
}

export default function StandingsShell() {
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string>("");
  const [leagueName, setLeagueName] = useState("Premier League");
  const [isSeasonSyncing, setIsSeasonSyncing] = useState(false);
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = useState(false);
  const [seasonMessage, setSeasonMessage] = useState<string | null>(null);
  const [unavailableSeasons, setUnavailableSeasons] = useState<string[]>([]);
  const seasonMenuRef = useRef<HTMLDivElement | null>(null);

  const loadStandings = useCallback(async () => {
    setErrorMessage(null);
    setStatus((current) => (current === "ready" ? "ready" : "loading"));

    try {
      const response = await fetch("/api/standings", { cache: "no-store" });
      const payload = (await response.json()) as StandingsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load standings.");
      }

      const data = Array.isArray(payload.data) ? payload.data : [];
      const sorted = [...data].sort((a, b) => {
        const seasonDiff = normalizeSeasonValue(b.season) - normalizeSeasonValue(a.season);
        if (seasonDiff !== 0) return seasonDiff;
        return a.position - b.position;
      });

      setRows(sorted);
      setStatus("ready");
      setLeagueName(payload.league === "PL" ? "Premier League" : payload.league || "League Standings");
      setSelectedSeason((current) =>
        !current || sorted.some((row) => row.season === current) ? current || sorted[0]?.season || "" : sorted[0]?.season || ""
      );
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load standings.");
    }
  }, []);

  useEffect(() => {
    void loadStandings();
  }, [loadStandings]);

  const seasons = useMemo(() => {
    const unique = Array.from(new Set(rows.map((row) => row.season)));
    return unique.sort((a, b) => normalizeSeasonValue(b) - normalizeSeasonValue(a));
  }, [rows]);
  const seasonSet = useMemo(() => new Set(seasons), [seasons]);
  const unavailableSeasonSet = useMemo(() => new Set(unavailableSeasons), [unavailableSeasons]);

  const currentSeasonStartYear = useMemo(() => getCurrentSeasonStartYear(), []);
  const minSeasonStartYear = Math.min(MIN_SEASON_START_YEAR, currentSeasonStartYear);

  const seasonWindow = useMemo(
    () =>
      Array.from(
        { length: currentSeasonStartYear - minSeasonStartYear + 1 },
        (_, index) => toSeasonLabel(currentSeasonStartYear - index)
      ),
    [currentSeasonStartYear, minSeasonStartYear]
  );

  useEffect(() => {
    if (!selectedSeason && seasons.length > 0) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, selectedSeason]);

  useEffect(() => {
    if (!isSeasonMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !seasonMenuRef.current) return;
      if (!seasonMenuRef.current.contains(target)) {
        setIsSeasonMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSeasonMenuOpen(false);
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
  }, [isSeasonMenuOpen]);

  const activeSeason = selectedSeason || seasons[0] || seasonWindow[0] || "";
  const filteredRows = useMemo(
    () => rows.filter((row) => row.season === activeSeason).sort((a, b) => a.position - b.position),
    [rows, activeSeason]
  );

  const activeSeasonStartYear = normalizeSeasonValue(activeSeason);

  const findNavigableSeasonStartYear = useCallback(
    (fromStartYear: number, direction: -1 | 1) => {
      let candidate = fromStartYear + direction;
      while (candidate <= currentSeasonStartYear && candidate >= minSeasonStartYear) {
        const label = toSeasonLabel(candidate);
        if (!unavailableSeasonSet.has(label) || seasonSet.has(label)) {
          return candidate;
        }
        candidate += direction;
      }
      return null;
    },
    [currentSeasonStartYear, minSeasonStartYear, unavailableSeasonSet, seasonSet]
  );

  const canGoPrev = findNavigableSeasonStartYear(activeSeasonStartYear, -1) !== null;
  const canGoNext = findNavigableSeasonStartYear(activeSeasonStartYear, 1) !== null;

  const ensureSeasonAvailable = useCallback(
    async (targetSeason: string) => {
      if (seasonSet.has(targetSeason)) {
        return true;
      }
      if (unavailableSeasonSet.has(targetSeason)) {
        setSeasonMessage("This season is currently unavailable.");
        return false;
      }

      setIsSeasonSyncing(true);
      setSeasonMessage(`Loading ${targetSeason} standings...`);

      try {
        const syncResponse = await fetch(`/api/sync/standings?season=${encodeURIComponent(targetSeason)}`, {
          method: "POST",
        });

        const syncPayload = (await syncResponse.json()) as { error?: string };
        if (!syncResponse.ok) {
          const providerMessage = syncPayload.error || `Could not sync ${targetSeason}`;
          const isPlanRestricted =
            syncResponse.status === 403 ||
            /403|restricted|permissions|subscription/i.test(providerMessage);

          if (isPlanRestricted) {
            setUnavailableSeasons((prev) =>
              prev.includes(targetSeason) ? prev : [...prev, targetSeason]
            );
            setSeasonMessage("This season is currently unavailable.");
            return false;
          }

          throw new Error(providerMessage);
        }

        const verifyResponse = await fetch(`/api/standings?season=${encodeURIComponent(targetSeason)}`, {
          cache: "no-store",
        });
        const verifyPayload = (await verifyResponse.json()) as StandingsPayload;
        if (!verifyResponse.ok) {
          throw new Error(verifyPayload.error || `Could not load ${targetSeason}`);
        }

        const seasonRows = Array.isArray(verifyPayload.data) ? verifyPayload.data : [];
        if (seasonRows.length === 0) {
          setSeasonMessage(`No standings available for ${targetSeason}.`);
          return false;
        }

        await loadStandings();
        setSeasonMessage(`Loaded ${targetSeason}.`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to load ${targetSeason}.`;
        if (/403|restricted|permissions|subscription/i.test(message)) {
          setUnavailableSeasons((prev) =>
            prev.includes(targetSeason) ? prev : [...prev, targetSeason]
          );
          setSeasonMessage("This season is currently unavailable.");
          return false;
        }
        setSeasonMessage(message);
        return false;
      } finally {
        setIsSeasonSyncing(false);
      }
    },
    [loadStandings, seasonSet, unavailableSeasonSet]
  );

  const navigateSeason = useCallback(
    async (direction: -1 | 1) => {
      if (!activeSeason) return;

      const targetStartYear = findNavigableSeasonStartYear(normalizeSeasonValue(activeSeason), direction);
      if (targetStartYear === null) return;

      const targetSeason = toSeasonLabel(targetStartYear);
      const available = await ensureSeasonAvailable(targetSeason);
      if (available) {
        setSelectedSeason(targetSeason);
      }
    },
    [activeSeason, ensureSeasonAvailable, findNavigableSeasonStartYear]
  );

  const handleSeasonSelect = useCallback(
    async (targetSeason: string) => {
      const targetStartYear = normalizeSeasonValue(targetSeason);
      if (targetStartYear > currentSeasonStartYear || targetStartYear < minSeasonStartYear) {
        return;
      }

      if (targetSeason === activeSeason) return;
      if (unavailableSeasonSet.has(targetSeason) && !seasonSet.has(targetSeason)) {
        setSeasonMessage("This season is currently unavailable.");
        return;
      }

      const available = await ensureSeasonAvailable(targetSeason);
      if (available) {
        setSelectedSeason(targetSeason);
      }
    },
    [activeSeason, currentSeasonStartYear, ensureSeasonAvailable, minSeasonStartYear, seasonSet, unavailableSeasonSet]
  );

  const leader = filteredRows[0];
  const updatedLabel = filteredRows[0]?.updatedAt
    ? `Updated ${formatRelativeTime(filteredRows[0].updatedAt)}`
    : "Updated recently";

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-4">
      <div className="relative overflow-visible rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_10px_26px_rgba(2,8,23,0.08)]">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(120%_90%_at_12%_0%,rgba(16,185,129,0.14),transparent_55%),radial-gradient(120%_95%_at_100%_0%,rgba(14,165,233,0.12),transparent_58%)] dark:bg-[radial-gradient(120%_95%_at_10%_0%,rgba(52,211,153,0.14),transparent_55%),radial-gradient(120%_95%_at_100%_0%,rgba(56,189,248,0.14),transparent_58%)]" />
        <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-[0.23] dark:opacity-[0.18] [background-image:linear-gradient(to_right,transparent_0,transparent_16px,rgba(148,163,184,0.22)_16px,rgba(148,163,184,0.22)_17px),linear-gradient(to_bottom,transparent_0,transparent_16px,rgba(148,163,184,0.22)_16px,rgba(148,163,184,0.22)_17px)] [background-size:17px_17px]" />

        <div className="relative space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
                Standings
              </p>
              <h1 className="mt-1.5 text-2xl font-bold text-[color:var(--foreground)] sm:text-[2rem]">
                {leagueName}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[color:var(--muted-foreground)]">
            {leader && (
              <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-sm text-[color:var(--foreground)]">
                <Trophy className="h-4 w-4 text-emerald-500" />
                <Link
                  href={`/teams/${leader.team.id}`}
                  className="font-semibold underline-offset-2 transition hover:text-sky-400 hover:underline"
                >
                  {leader.team.name}
                </Link>
                <span className="text-[color:var(--muted-foreground)]">{leader.points} pts</span>
              </div>
            )}
          </div>

          <div className="-mx-4 border-t border-[color:var(--surface-border)] px-4 pt-3 sm:-mx-5 sm:px-5">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-[20px] text-xs text-[color:var(--muted-foreground)]">
                {seasonMessage || `Browse seasons from ${toSeasonLabel(minSeasonStartYear)} to ${toSeasonLabel(currentSeasonStartYear)}.`}
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => void navigateSeason(-1)}
                  disabled={isSeasonSyncing || !canGoPrev}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label="Previous season"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div ref={seasonMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setIsSeasonMenuOpen((open) => !open)}
                    disabled={isSeasonSyncing}
                    aria-expanded={isSeasonMenuOpen}
                    aria-haspopup="listbox"
                    className="inline-flex h-10 min-w-[200px] items-center justify-between rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 text-sm text-[color:var(--foreground)] shadow-[0_6px_14px_rgba(2,8,23,0.05)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      {isSeasonSyncing ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />
                      ) : (
                        <CalendarDays className="h-4 w-4 shrink-0 text-sky-500" />
                      )}
                      <span className="text-[color:var(--muted-foreground)]">Season</span>
                      <span className="truncate font-semibold text-[color:var(--foreground)]">{activeSeason}</span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-[color:var(--muted-foreground)] transition-transform ${
                        isSeasonMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isSeasonMenuOpen && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-[220px] overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_24px_rgba(2,8,23,0.16)]">
                      <div className="max-h-72 overflow-auto p-1.5">
                        {seasonWindow.map((season) => {
                          const isUnavailable = unavailableSeasonSet.has(season) && !seasonSet.has(season);
                          const isLoaded = seasonSet.has(season);
                          const isSelected = season === activeSeason;

                          return (
                            <button
                              key={season}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              disabled={isUnavailable}
                              onClick={() => {
                                setIsSeasonMenuOpen(false);
                                void handleSeasonSelect(season);
                              }}
                              className={`inline-flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                                isUnavailable
                                  ? "cursor-not-allowed text-[color:var(--muted-foreground)] opacity-60"
                                  : isSelected
                                  ? "bg-sky-500/20 font-semibold text-sky-400"
                                  : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                              }`}
                            >
                              <span>{season}</span>
                              {!isLoaded && (
                                <span className="text-[11px] font-medium text-[color:var(--muted-foreground)]">
                                  {isUnavailable ? "Unavailable" : "Load"}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void navigateSeason(1)}
                  disabled={isSeasonSyncing || !canGoNext}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label="Next season"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {status === "loading" && <StandingsSkeleton />}

      {status === "error" && (
        <div className="rounded-2xl border border-rose-400/45 bg-rose-500/10 p-5 text-rose-200">
          <p className="font-semibold">Could not load standings</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
          <button type="button" onClick={() => void loadStandings()} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      )}

      {status === "ready" && filteredRows.length === 0 && (
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 text-center">
          <p className="text-lg font-semibold text-[color:var(--foreground)]">No standings available yet</p>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            Try refreshing after syncing teams and standings data.
          </p>
        </div>
      )}

      {status === "ready" && filteredRows.length > 0 && (
        <>
          <div className="flex justify-end">
            <p className="text-xs text-[color:var(--muted-foreground)]">{updatedLabel}</p>
          </div>
        <div className="overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_10px_24px_rgba(2,8,23,0.06)]">
            <table className="min-w-full text-left">
              <thead className="sticky top-0 z-20 border-b border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
                <tr className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
                  <th className="px-3 py-2.5 font-semibold sm:px-4">#</th>
                  <th className="px-3 py-2.5 font-semibold sm:px-4">Club</th>
                  <th className="px-2 py-2.5 text-center font-semibold">P</th>
                  <th className="hidden px-2 py-2.5 text-center font-semibold sm:table-cell">W</th>
                  <th className="hidden px-2 py-2.5 text-center font-semibold sm:table-cell">D</th>
                  <th className="hidden px-2 py-2.5 text-center font-semibold sm:table-cell">L</th>
                  <th className="hidden px-2 py-2.5 text-center font-semibold sm:table-cell">GD</th>
                  <th className="px-3 py-2.5 text-right font-semibold sm:px-4">Pts</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-[color:var(--surface-border)] last:border-b-0 hover:bg-[color:var(--surface-elevated)] ${getRowTone(
                      row.position,
                      filteredRows.length
                    )}`}
                  >
                    <td className="px-3 py-2.5 text-xs font-semibold text-[color:var(--foreground)] sm:px-4 sm:text-sm">
                      {row.position}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4">
                      <div className="flex items-center gap-2.5 sm:gap-3">
                        {row.team.crestUrl ? (
                          <img
                            src={row.team.crestUrl}
                            alt={`${row.team.name} crest`}
                            className="h-4.5 w-4.5 object-contain sm:h-5 sm:w-5"
                          />
                        ) : (
                          <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[color:var(--surface-elevated)] text-[8px] font-bold text-[color:var(--foreground)] sm:h-5 sm:w-5 sm:text-[9px]">
                            {row.team.shortName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/teams/${row.team.id}`}
                            className="block truncate text-xs font-semibold text-[color:var(--foreground)] underline-offset-2 transition hover:text-sky-400 hover:underline sm:text-sm"
                          >
                            {row.team.name}
                          </Link>
                          <p className="hidden truncate text-[11px] text-[color:var(--muted-foreground)] sm:block">
                            {row.team.shortName}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center text-xs text-[color:var(--foreground)] sm:text-sm">
                      {row.playedGames}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center text-sm text-[color:var(--foreground)] sm:table-cell">{row.won}</td>
                    <td className="hidden px-2 py-2.5 text-center text-sm text-[color:var(--foreground)] sm:table-cell">{row.draw}</td>
                    <td className="hidden px-2 py-2.5 text-center text-sm text-[color:var(--foreground)] sm:table-cell">{row.lost}</td>
                    <td className="hidden px-2 py-2.5 text-center text-sm font-semibold text-[color:var(--foreground)] sm:table-cell">
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-[color:var(--foreground)] sm:px-4 sm:text-sm">
                      {row.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          <div className="border-t border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-2 text-[11px] text-[color:var(--muted-foreground)] sm:hidden">
            Compact view on small screens. Rotate or widen window for full stats.
          </div>

            <div className="hidden flex-wrap items-center justify-between gap-2 border-t border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-xs text-[color:var(--muted-foreground)] sm:flex">
              <span className="inline-flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-emerald-500" />
              Top 4 highlighted for Champions League places.
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-sky-500" />
              5th highlighted for Europa League place.
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                Bottom 3 indicate relegation zone.
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
