"use client";

import Link from "next/link";
import { Building2, ChevronDown, Search, Shield, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TeamRecord = {
  id: number;
  externalId: string;
  name: string;
  shortName: string;
  crestUrl: string | null;
  venue: string;
  createdAt: string;
  updatedAt: string;
};

type TeamsPayload = {
  data?: TeamRecord[];
  league?: string;
  error?: string;
};

type SortMode = "name-asc" | "name-desc" | "updated-desc";
type LoadState = "loading" | "ready" | "error";

function TeamCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[color:var(--surface-elevated)]" />
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-[color:var(--surface-elevated)]" />
          <div className="h-3 w-20 rounded bg-[color:var(--surface-elevated)]" />
        </div>
      </div>
      <div className="mt-4 h-3 w-40 rounded bg-[color:var(--surface-elevated)]" />
    </div>
  );
}

function getTeamInitials(name: string, shortName: string) {
  if (shortName?.trim()) {
    return shortName.trim().slice(0, 2).toUpperCase();
  }
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function TeamsDirectoryShell() {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [leagueName, setLeagueName] = useState("Premier League");
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  const loadTeams = useCallback(async () => {
    setErrorMessage(null);
    setLoadState((state) => (state === "ready" ? "ready" : "loading"));

    try {
      const response = await fetch("/api/teams", { cache: "no-store" });
      const payload = (await response.json()) as TeamsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load teams.");
      }

      const data = Array.isArray(payload.data) ? payload.data : [];
      setTeams(data);
      setLoadState("ready");
      setLeagueName(payload.league === "PL" ? "Premier League" : payload.league || "League Teams");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load teams.");
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (!isSortMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !sortMenuRef.current) return;
      if (!sortMenuRef.current.contains(target)) {
        setIsSortMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSortMenuOpen(false);
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
  }, [isSortMenuOpen]);

  const sortLabel =
    sortMode === "name-asc"
      ? "Name (A-Z)"
      : sortMode === "name-desc"
      ? "Name (Z-A)"
      : "Recently Updated";

  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase();

    const searched = teams.filter((team) => {
      if (!query) return true;
      return (
        team.name.toLowerCase().includes(query) ||
        team.shortName.toLowerCase().includes(query) ||
        team.venue.toLowerCase().includes(query)
      );
    });

    return searched.sort((a, b) => {
      if (sortMode === "name-asc") {
        return a.name.localeCompare(b.name);
      }
      if (sortMode === "name-desc") {
        return b.name.localeCompare(a.name);
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [search, sortMode, teams]);

  const venueCount = useMemo(
    () => new Set(teams.map((team) => team.venue.trim().toLowerCase())).size,
    [teams]
  );

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_10px_26px_rgba(2,8,23,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_90%_at_10%_0%,rgba(16,185,129,0.16),transparent_56%),radial-gradient(120%_80%_at_100%_0%,rgba(14,165,233,0.14),transparent_62%)]" />
        <div className="relative space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
              Teams
            </p>
            <h1 className="text-3xl font-bold text-[color:var(--foreground)] sm:text-4xl">
              {leagueName} Clubs
            </h1>
            <p className="max-w-2xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
              Browse every team, then open each club page for deeper details.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Teams</p>
              <p className="mt-1 text-xl font-bold text-[color:var(--foreground)]">{teams.length}</p>
            </div>
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Venues</p>
              <p className="mt-1 text-xl font-bold text-[color:var(--foreground)]">{venueCount}</p>
            </div>
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">View</p>
              <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">Click any card for team page</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search team, short name, or venue..."
            className="h-11 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] pl-10 pr-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
          />
        </label>

        <div ref={sortMenuRef} className="relative self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsSortMenuOpen((open) => !open)}
            aria-expanded={isSortMenuOpen}
            aria-haspopup="listbox"
            className="inline-flex h-10 min-w-[210px] items-center justify-between rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 text-sm text-[color:var(--foreground)] shadow-[0_6px_14px_rgba(2,8,23,0.05)] transition hover:bg-[color:var(--surface)]"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-sky-500" />
              <span className="text-[color:var(--muted-foreground)]">Sort</span>
              <span className="truncate font-semibold">{sortLabel}</span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[color:var(--muted-foreground)] transition-transform ${
                isSortMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isSortMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-[240px] overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_24px_rgba(2,8,23,0.16)]">
              <div className="max-h-72 overflow-auto p-1.5">
                {(
                  [
                    { value: "name-asc", label: "Name (A-Z)" },
                    { value: "name-desc", label: "Name (Z-A)" },
                    { value: "updated-desc", label: "Recently Updated" },
                  ] as const
                ).map((option) => {
                  const isSelected = sortMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSortMode(option.value);
                        setIsSortMenuOpen(false);
                      }}
                      className={`inline-flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? "bg-sky-500/20 font-semibold text-sky-400"
                          : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {loadState === "loading" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, index) => (
            <TeamCardSkeleton key={`team-card-skeleton-${index}`} />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/12 p-5 text-rose-100">
          <p className="font-semibold">Could not load teams</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
          <button type="button" onClick={() => void loadTeams()} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      )}

      {loadState === "ready" && filteredTeams.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface)] p-8 text-center">
          <p className="text-lg font-semibold text-[color:var(--foreground)]">No teams match your search</p>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            Try a different team name, venue, or clear the search box.
          </p>
        </div>
      )}

      {loadState === "ready" && filteredTeams.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTeams.map((team) => (
            <Link
              key={team.id}
              href={`/teams/${team.id}`}
              className="group rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_8px_22px_rgba(2,8,23,0.08)] transition hover:border-sky-400/60 hover:bg-[color:var(--surface-elevated)]"
            >
              <div className="flex items-center gap-3">
                {team.crestUrl ? (
                  <img src={team.crestUrl} alt={`${team.name} crest`} className="h-11 w-11 object-contain" />
                ) : (
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-sm font-bold text-[color:var(--foreground)]">
                    {getTeamInitials(team.name, team.shortName)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-[color:var(--foreground)]">{team.name}</p>
                  <p className="truncate text-sm text-[color:var(--muted-foreground)]">{team.shortName}</p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <p className="inline-flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
                  <Building2 className="h-4 w-4" />
                  <span className="truncate">{team.venue}</span>
                </p>
              </div>

              <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-sky-400 transition group-hover:text-sky-300">
                <Shield className="h-4 w-4" />
                Open Team Page
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
