"use client";

import Link from "next/link";
import { MessageCircle, Search, Shield } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGeneralCommunityCardBackground,
  createGeneralCommunityCardLightOverlay,
  createTeamCommunityCardBackground,
  createTeamCommunityCardLightOverlay,
} from "@/lib/communityTheme";

type TeamRecord = {
  id: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
  venue: string;
};

type TeamsPayload = {
  data?: TeamRecord[];
  error?: string;
};

type LoadState = "loading" | "ready" | "error";

function CommunityCardSkeleton() {
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
      <div className="mt-4 h-9 w-36 rounded-lg bg-[color:var(--surface-elevated)]" />
    </div>
  );
}

function getTeamInitials(name: string, shortName: string) {
  if (shortName?.trim()) return shortName.trim().slice(0, 2).toUpperCase();
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function CommunitiesHubShell() {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadTeams = useCallback(async () => {
    setErrorMessage(null);
    setLoadState((state) => (state === "ready" ? "ready" : "loading"));

    try {
      const response = await fetch("/api/teams", { cache: "no-store" });
      const payload = (await response.json()) as TeamsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load communities.");
      }

      setTeams(Array.isArray(payload.data) ? payload.data : []);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load communities.");
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return teams;

    return teams.filter((team) => {
      return (
        team.name.toLowerCase().includes(query) ||
        team.shortName.toLowerCase().includes(query) ||
        team.venue.toLowerCase().includes(query)
      );
    });
  }, [search, teams]);

  return (
    <section className="mx-auto w-full max-w-[1240px] space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_10px_26px_rgba(2,8,23,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(140%_95%_at_5%_0%,rgba(14,165,233,0.14),transparent_52%),radial-gradient(120%_88%_at_100%_0%,rgba(16,185,129,0.12),transparent_58%)]" />
        <div className="relative space-y-4 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
            Communities
          </p>
          <h1 className="text-3xl font-bold text-[color:var(--foreground)] sm:text-4xl">
            Find Your Community
          </h1>
          <p className="max-w-3xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
            Jump into club-specific communities or the general Premier League discussion space.
            Pick a community to start reading threads and matchday conversations.
          </p>
        </div>
      </div>

      <Link
        href="/communities/general"
        className="group relative block overflow-hidden rounded-2xl border border-white/20 px-5 py-5 text-white shadow-[0_14px_36px_rgba(2,8,23,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(2,8,23,0.32)] [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:shadow-[0_12px_28px_rgba(15,23,42,0.10)] [html[data-theme='light']_&]:hover:shadow-[0_16px_34px_rgba(15,23,42,0.16)]"
        style={createGeneralCommunityCardBackground()}
      >
        <div
          className="pointer-events-none absolute inset-0 hidden [html[data-theme='light']_&]:block"
          style={createGeneralCommunityCardLightOverlay()}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/18 via-black/28 to-black/40 [html[data-theme='light']_&]:from-white/8 [html[data-theme='light']_&]:via-white/4 [html[data-theme='light']_&]:to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[74%] [html[data-theme='light']_&]:block [background:linear-gradient(90deg,rgba(15,23,42,0.52)_0%,rgba(15,23,42,0.38)_34%,rgba(15,23,42,0.18)_62%,rgba(15,23,42,0)_100%)]" />

        <div className="relative flex items-center gap-4">
          <MessageCircle className="h-8 w-8 shrink-0 text-sky-100 drop-shadow-[0_8px_16px_rgba(2,8,23,0.32)] [html[data-theme='light']_&]:text-sky-700" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72 [html[data-theme='light']_&]:text-white/80">
              Featured Community
            </p>
            <p className="text-3xl font-black leading-tight text-white [html[data-theme='light']_&]:text-white">
              Premier League General
            </p>
            <p className="text-base text-white/88 [html[data-theme='light']_&]:text-white/90">
              League-wide discussion, opinions, and matchweek talk.
            </p>
          </div>
        </div>
      </Link>

      <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
        <label className="relative block w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by club or venue..."
            className="h-11 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] pl-10 pr-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
          />
        </label>
      </div>

      {loadState === "loading" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, index) => (
            <CommunityCardSkeleton key={`community-card-skeleton-${index}`} />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/12 p-5 text-rose-100">
          <p className="font-semibold">Could not load communities</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
          <button type="button" onClick={() => void loadTeams()} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      )}

      {loadState === "ready" && filteredTeams.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface)] p-8 text-center">
          <p className="text-lg font-semibold text-[color:var(--foreground)]">No communities match your search</p>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            Try another team name or venue term.
          </p>
        </div>
      )}

      {loadState === "ready" && filteredTeams.length > 0 && (
        <div className="relative">
          {filteredTeams.map((team, index) => (
            <Link
              key={team.id}
              href={`/communities/${team.id}`}
              className="group relative mb-3 block overflow-hidden rounded-2xl border border-white/20 p-5 text-white shadow-[0_14px_36px_rgba(2,8,23,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(2,8,23,0.32)] [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:shadow-[0_12px_28px_rgba(15,23,42,0.10)] [html[data-theme='light']_&]:hover:shadow-[0_16px_34px_rgba(15,23,42,0.16)] sm:mb-4 sm:-mt-2 sm:first:mt-0"
              style={{
                ...createTeamCommunityCardBackground(team.name),
                zIndex: filteredTeams.length - index,
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 hidden [html[data-theme='light']_&]:block"
                style={createTeamCommunityCardLightOverlay(team.name)}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/18 via-black/30 to-black/40 [html[data-theme='light']_&]:from-white/6 [html[data-theme='light']_&]:via-white/2 [html[data-theme='light']_&]:to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[74%] [html[data-theme='light']_&]:block [background:linear-gradient(90deg,rgba(15,23,42,0.52)_0%,rgba(15,23,42,0.40)_34%,rgba(15,23,42,0.22)_60%,rgba(15,23,42,0.00)_100%)]" />
              <div className="relative flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72 [html[data-theme='light']_&]:text-white/80">
                    Team Community
                  </p>
                  <p className="truncate text-xl font-bold sm:text-2xl">
                    {team.name} Thread
                  </p>
                  <p className="max-w-xl truncate text-sm text-white/88 [html[data-theme='light']_&]:text-white/90">
                    Join supporters, matchday reactions, and club-specific discussion.
                  </p>
                  <p className="inline-flex items-center gap-2 text-sm text-white/84 [html[data-theme='light']_&]:text-white/88">
                    <Shield className="h-4 w-4 text-white/78 [html[data-theme='light']_&]:text-white/84" />
                    <span className="truncate">{team.venue}</span>
                  </p>
                </div>
                <div className="shrink-0">
                  {team.crestUrl ? (
                    <img
                      src={team.crestUrl}
                      alt={`${team.name} crest`}
                      className="h-20 w-20 object-contain drop-shadow-[0_10px_24px_rgba(2,8,23,0.38)] sm:h-24 sm:w-24"
                    />
                  ) : (
                    <span className="inline-flex h-20 w-20 items-center justify-center text-2xl font-black text-white/95 sm:h-24 sm:w-24 sm:text-3xl">
                      {getTeamInitials(team.name, team.shortName)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
