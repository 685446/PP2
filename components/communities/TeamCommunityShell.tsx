"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  MessageSquare,
  PencilLine,
  Search,
  ShieldCheck,
  Star,
  Trophy,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DiscussionActivityCard, MatchActivityCard } from "@/components/shared/ActivityCards";
import ThreadComposerForm from "@/components/shared/ThreadComposerForm";
import { EmptyStateCard, ErrorStateCard, LoadingStateList } from "@/components/shared/StateBlocks";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import {
  getDefaultPollDeadline,
  INITIAL_THREAD_COMPOSER_CORE_STATE,
  normalizePollOptions,
  normalizeThreadTags,
  type ThreadComposerCoreState,
} from "@/components/shared/threadComposerUtils";
import {
  createCommunityBannerLightOverlayStyle,
  createCommunityBannerStyle,
  resolveCommunityPalette,
  type CommunityPalette,
} from "@/lib/communityTheme";
import { buildThreadHref } from "@/lib/threadLinks";

type CommunityTeam = {
  id: number | string;
  name: string;
  shortName: string;
  crestUrl: string | null;
  venue: string;
};

type ThreadRecord = {
  id: number;
  title: string;
  body: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: string;
  openAt: string;
  author: {
    id: number;
    username: string;
    avatar: string;
  };
  team: {
    id: number;
    name: string;
    crestUrl: string | null;
  } | null;
  match: {
    id: number;
    status: string;
    utcDate: string;
    matchWeek: number;
    season: string;
    homeScore: number | null;
    awayScore: number | null;
    homeTeam: {
      id: number;
      name: string;
      shortName: string;
      crestUrl: string | null;
    };
    awayTeam: {
      id: number;
      name: string;
      shortName: string;
      crestUrl: string | null;
    };
  } | null;
  tags: Array<{
    tag: {
      id: number;
      name: string;
    };
  }>;
  _count: {
    posts: number;
  };
};

type CommunityPayload = {
  community: CommunityTeam;
  threads: ThreadRecord[];
  summary: {
    TEAM: number;
    MATCH: number;
    GENERAL?: number;
  };
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  error?: string;
};

type LoadState = "loading" | "ready" | "error";
type ThreadTypeFilter = "ALL" | "TEAM" | "MATCH";
type CommunityComposerState = ThreadComposerCoreState;
const PAGE_LIMIT = 12;
const INITIAL_COMPOSER_STATE: CommunityComposerState = INITIAL_THREAD_COMPOSER_CORE_STATE;

const LOADING_COMMUNITY_PALETTE: CommunityPalette = {
  primaryRgb: "14,165,233",
  secondaryRgb: "30,64,175",
  primaryLabel: "Sky",
  secondaryLabel: "Navy",
  source: "manual",
};

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusToBadgeLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "FINISHED") return "FT";
  if (normalized === "IN_PLAY") return "LIVE";
  if (normalized === "PAUSED") return "HT";
  if (normalized === "SCHEDULED" || normalized === "TIMED") return "Scheduled";
  return normalized;
}

function communityDisplayName(team: CommunityTeam | null, isGeneralCommunity: boolean) {
  if (isGeneralCommunity) return "Premier League General";
  if (!team) return "Team Community";
  return team.shortName?.trim() || team.name;
}


function MatchThreadCard({
  thread,
  href,
}: {
  thread: ThreadRecord;
  href: string;
}) {
  if (!thread.match) return null;

  const { match } = thread;
  const contextLine =
    match.matchWeek != null
      ? `Match Thread: ${match.homeTeam.name} vs ${match.awayTeam.name} | Matchweek ${match.matchWeek}`
      : `Match Thread: ${match.homeTeam.name} vs ${match.awayTeam.name}`;

  return (
    <MatchActivityCard
      href={href}
      ariaLabel={`${thread.title}. ${contextLine}`}
      leagueLabel="Premier League"
      statusLabel={statusToBadgeLabel(match.status)}
      timeLabel={formatRelativeDate(thread.openAt || thread.createdAt)}
      homeTeam={{
        name: match.homeTeam.name,
        shortName: match.homeTeam.shortName,
        crestUrl: match.homeTeam.crestUrl,
      }}
      awayTeam={{
        name: match.awayTeam.name,
        shortName: match.awayTeam.shortName,
        crestUrl: match.awayTeam.crestUrl,
      }}
      homeScore={match.homeScore}
      awayScore={match.awayScore}
      headline={contextLine}
      count={thread._count.posts}
    />
  );
}

function TeamThreadCard({
  thread,
  href,
  label = "Team Thread",
}: {
  thread: ThreadRecord;
  href: string;
  label?: string;
}) {
  return (
    <DiscussionActivityCard
      href={href}
      ariaLabel={`${thread.title}. ${thread.body}`}
      headerLeft={
        <div className="inline-flex items-center gap-2">
          <img
            src={thread.author.avatar || "/avatars/default1.png"}
            alt={`${thread.author.username} avatar`}
            className="h-8 w-8 rounded-full object-cover ring-1 ring-[color:var(--surface-border)]"
          />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-[color:var(--foreground)]">{thread.author.username}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">{label}</p>
          </div>
        </div>
      }
      timeLabel={formatRelativeDate(thread.createdAt)}
      title={thread.title}
      summary={thread.body}
      summaryClassName="line-clamp-2"
      footerLeft={
        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
          {thread.tags.slice(0, 3).map(({ tag }) => (
            <span
              key={tag.id}
              className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--foreground)]"
            >
              {tag.name}
            </span>
          ))}
          {thread.tags.length === 0 && (
            <span className="text-xs text-[color:var(--muted-foreground)]">No tags yet</span>
          )}
        </div>
      }
      count={thread._count.posts}
    />
  );
}

export default function TeamCommunityShell({
  teamId,
  communityKind = "team",
}: {
  teamId: string;
  communityKind?: "team" | "general";
}) {
  const isGeneralCommunity = communityKind === "general";
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<CommunityTeam | null>(null);
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [summary, setSummary] = useState({ TEAM: 0, MATCH: 0, GENERAL: 0 });
  const [typeFilter, setTypeFilter] = useState<ThreadTypeFilter>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPending, setComposerPending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composer, setComposer] = useState<CommunityComposerState>(INITIAL_COMPOSER_STATE);
  const loadMoreAnchorRef = useRef<HTMLDivElement | null>(null);
  const bannerPalette = team
    ? resolveCommunityPalette(team.name)
    : isGeneralCommunity
      ? resolveCommunityPalette("Premier League General")
      : LOADING_COMMUNITY_PALETTE;
  const bannerStyle = createCommunityBannerStyle(bannerPalette);
  const bannerLightStyle = createCommunityBannerLightOverlayStyle(bannerPalette);
  const loginHref = `/login?next=${encodeURIComponent(
    isGeneralCommunity ? "/communities/general" : `/communities/${teamId}`
  )}`;

  const loadCommunity = useCallback(
    async (targetPage: number, append: boolean) => {
      setError(null);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadState("loading");
      }

      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_LIMIT));
        params.set("page", String(targetPage));
        if (typeFilter !== "ALL" && !isGeneralCommunity) {
          params.set("type", typeFilter);
        }
        if (debouncedSearch) {
          params.set("q", debouncedSearch);
        }

        const response = await fetch(
          `/api/communities/${encodeURIComponent(teamId)}/threads?${params.toString()}`,
          { cache: "no-store" }
        );

        const payload = (await response.json()) as CommunityPayload;
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load this community.");
        }

        const nextThreads = Array.isArray(payload.threads) ? payload.threads : [];
        setTeam(payload.community);
        setSummary({
          TEAM: payload.summary?.TEAM ?? 0,
          MATCH: payload.summary?.MATCH ?? 0,
          GENERAL: payload.summary?.GENERAL ?? 0,
        });

        setThreads((current) => {
          if (!append) return nextThreads;

          const seen = new Set(current.map((thread) => thread.id));
          const merged = [...current];
          for (const thread of nextThreads) {
            if (!seen.has(thread.id)) merged.push(thread);
          }
          return merged;
        });

        const resolvedPage = payload.page ?? targetPage;
        const resolvedTotal = payload.total ?? 0;
        const resolvedTotalPages = payload.totalPages ?? 1;

        setPage(resolvedPage);
        setTotal(resolvedTotal);
        setHasMore(resolvedPage < resolvedTotalPages);
        setLoadState("ready");
      } catch (loadError) {
        setLoadState("error");
        setError(loadError instanceof Error ? loadError.message : "Failed to load this community.");
      } finally {
        setLoadingMore(false);
      }
    },
    [debouncedSearch, isGeneralCommunity, teamId, typeFilter]
  );

  useEffect(() => {
    setSession(loadAuthSession());
    const syncSession = () => setSession(loadAuthSession());
    window.addEventListener(AUTH_CHANGED_EVENT, syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  useEffect(() => {
    setComposer((current) =>
      current.pollDeadline
        ? current
        : {
            ...current,
            pollDeadline: getDefaultPollDeadline(),
          }
    );
  }, []);

  useEffect(() => {
    if (!composerOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposerOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [composerOpen]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    if (!isGeneralCommunity) return;
    setTypeFilter("ALL");
  }, [isGeneralCommunity]);

  useEffect(() => {
    setThreads([]);
    setPage(0);
    setTotal(0);
    setHasMore(false);
    void loadCommunity(1, false);
  }, [loadCommunity]);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || loadState !== "ready") return;
    void loadCommunity(page + 1, true);
  }, [hasMore, loadCommunity, loadState, loadingMore, page]);

  useEffect(() => {
    if (!hasMore || loadingMore || loadState !== "ready") return;
    const anchor = loadMoreAnchorRef.current;
    if (!anchor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          handleLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "220px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [handleLoadMore, hasMore, loadState, loadingMore]);

  const resetComposer = useCallback(() => {
    setComposer({
      ...INITIAL_COMPOSER_STATE,
      pollDeadline: getDefaultPollDeadline(),
    });
    setComposerError(null);
  }, []);

  const handleCreateTeamThread = useCallback(async () => {
    setComposerError(null);
    setComposerPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to create a thread.");
      }

      if (!team && !isGeneralCommunity) {
        throw new Error("Community team is still loading.");
      }

      const trimmedTitle = composer.title.trim();
      const trimmedBody = composer.body.trim();

      const normalizedTags = normalizeThreadTags(composer.tags);

      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({
          title: trimmedTitle,
          body: trimmedBody,
          type: isGeneralCommunity ? "GENERAL" : "TEAM",
          ...(!isGeneralCommunity ? { teamId: Number(team?.id) } : {}),
          ...(normalizedTags.length > 0 ? { tags: normalizedTags } : {}),
        }),
      });

      const result = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Could not create thread.");
      }

      if (!result.id) {
        throw new Error("Thread was created, but no thread id was returned.");
      }

      if (composer.includePoll) {
        const normalizedOptions = normalizePollOptions(composer.pollOptions);

        if (!composer.pollQuestion.trim()) {
          throw new Error("Add a poll question or turn off the poll option.");
        }

        if (normalizedOptions.length < 2) {
          throw new Error("Polls need at least 2 options.");
        }

        const parsedDeadline = Date.parse(composer.pollDeadline);
        if (Number.isNaN(parsedDeadline)) {
          throw new Error("Choose a valid poll deadline.");
        }

        const pollResponse = await fetch(`/api/threads/${result.id}/polls`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${activeSession.accessToken}`,
          },
          body: JSON.stringify({
            question: composer.pollQuestion.trim(),
            options: normalizedOptions,
            deadline: new Date(parsedDeadline).toISOString(),
          }),
        });

        const pollPayload = (await pollResponse.json().catch(() => ({}))) as { error?: string };
        if (!pollResponse.ok) {
          throw new Error(
            pollPayload.error
              ? `Thread created, but poll could not be added: ${pollPayload.error}`
              : "Thread created, but poll could not be added."
          );
        }
      }

      resetComposer();
      setComposerOpen(false);
      await loadCommunity(1, false);
    } catch (createError) {
      setComposerError(
        createError instanceof Error
          ? createError.message
          : isGeneralCommunity
            ? "Could not create general thread."
            : "Could not create team thread."
      );
    } finally {
      setComposerPending(false);
    }
  }, [composer, isGeneralCommunity, loadCommunity, resetComposer, team]);

  const closeComposer = useCallback(() => {
    if (composerPending) return;
    setComposerOpen(false);
  }, [composerPending]);

  const displayedGeneralCount = summary.GENERAL || summary.TEAM;
  const filterOptions = isGeneralCommunity
    ? (["ALL"] as const)
    : (["ALL", "TEAM", "MATCH"] as const);

  return (
    <section className="mx-auto w-full max-w-[1240px] space-y-5">
      <div
        className="relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_30px_rgba(2,8,23,0.08)] [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:shadow-[0_10px_26px_rgba(15,23,42,0.10)] xl:mx-auto xl:w-full xl:max-w-[1104px]"
        style={bannerStyle}
      >
        <div
          className="pointer-events-none absolute inset-0 hidden [html[data-theme='light']_&]:block"
          style={bannerLightStyle}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/12 via-black/18 to-black/24 [html[data-theme='light']_&]:from-white/12 [html[data-theme='light']_&]:via-white/6 [html[data-theme='light']_&]:to-transparent" />

        <div className="relative flex flex-col gap-4 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
            <Link href="/communities" className="btn-secondary inline-flex w-full items-center justify-center gap-2 backdrop-blur-sm sm:w-auto sm:justify-start">
              <ArrowLeft className="h-4 w-4" />
              All Communities
            </Link>
            {isGeneralCommunity ? (
              <Link href="/discussions" className="btn-secondary w-full justify-center backdrop-blur-sm sm:w-auto">
                Open Discussions
              </Link>
            ) : team ? (
              <Link href={`/teams/${team.id}`} className="btn-secondary w-full justify-center backdrop-blur-sm sm:w-auto">
                Open Team Page
              </Link>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center">
              {isGeneralCommunity ? (
                <span className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/16 text-sky-100 backdrop-blur-sm [html[data-theme='light']_&]:border-sky-400/35 [html[data-theme='light']_&]:bg-white/72 [html[data-theme='light']_&]:text-sky-700">
                  <MessageSquare className="h-10 w-10" />
                </span>
              ) : team?.crestUrl ? (
                <img
                  src={team.crestUrl}
                  alt={`${team.name} crest`}
                  className="h-20 w-20 shrink-0 object-contain drop-shadow-[0_12px_24px_rgba(2,8,23,0.42)]"
                />
              ) : (
                <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/16 text-lg font-black text-white [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:bg-white/85 [html[data-theme='light']_&]:text-slate-700">
                  {team?.shortName?.slice(0, 2).toUpperCase() || "TM"}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300 [html[data-theme='light']_&]:text-sky-700">
                  Community
                </p>
                <h1 className="text-[30px] font-black leading-[1.05] text-white [html[data-theme='light']_&]:text-slate-900 sm:text-[34px]">
                  {communityDisplayName(team, isGeneralCommunity)}
                </h1>
                <p className="text-sm text-white/85 [html[data-theme='light']_&]:text-slate-700 sm:truncate">
                  {isGeneralCommunity
                    ? "League-wide discussion, opinions, and matchweek talk."
                    : team
                      ? `${team.venue} - Team and match discussion in one feed.`
                      : "Loading community..."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/22 bg-black/28 px-3 py-1.5 text-xs font-semibold text-white/95 backdrop-blur-sm [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:bg-white/72 [html[data-theme='light']_&]:text-slate-800">
                <MessageSquare className="h-3.5 w-3.5 text-sky-300 [html[data-theme='light']_&]:text-sky-600" />
                {isGeneralCommunity ? `${displayedGeneralCount} general threads` : `${summary.TEAM} team threads`}
              </span>
              {isGeneralCommunity ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/22 bg-black/28 px-3 py-1.5 text-xs font-semibold text-white/95 backdrop-blur-sm [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:bg-white/72 [html[data-theme='light']_&]:text-slate-800">
                  <Star className="h-3.5 w-3.5 text-sky-300 [html[data-theme='light']_&]:text-sky-600" />
                  League-wide hub
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/22 bg-black/28 px-3 py-1.5 text-xs font-semibold text-white/95 backdrop-blur-sm [html[data-theme='light']_&]:border-slate-300/75 [html[data-theme='light']_&]:bg-white/72 [html[data-theme='light']_&]:text-slate-800">
                  <Trophy className="h-3.5 w-3.5 text-sky-300 [html[data-theme='light']_&]:text-sky-600" />
                  {summary.MATCH} match threads
                </span>
              )}
            </div>

          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,760px)_320px] xl:justify-center">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full gap-1 overflow-x-auto rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-1 [scrollbar-width:none] [-ms-overflow-style:none] md:inline-flex md:w-auto md:overflow-visible">
              {filterOptions.map((option) => {
                const active = typeFilter === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTypeFilter(option)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-sky-500/15 text-sky-600"
                        : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    {option === "ALL"
                      ? isGeneralCommunity
                        ? "General Threads"
                        : "All Threads"
                      : option === "TEAM"
                        ? "Team Threads"
                        : "Match Threads"}
                  </button>
                );
              })}
            </div>

            <label className="relative block w-full md:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title, body, author, tags..."
                className="h-11 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] pl-10 pr-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500"
              />
            </label>
          </div>

          {loadState === "loading" && (
            <LoadingStateList
              count={4}
              itemKeyPrefix="community-thread-skeleton"
            />
          )}

          {loadState === "error" && (
            <ErrorStateCard
              title="Could not load this community"
              message={error || "Please try again."}
              onRetry={() => void loadCommunity(1, false)}
              className="p-5 text-rose-100 border-rose-400/40 bg-rose-500/12"
              titleClassName="text-base font-semibold"
              messageClassName="opacity-90 text-rose-100"
            />
          )}

          {loadState === "ready" && threads.length === 0 && (
            <EmptyStateCard
              title={isGeneralCommunity ? "No general threads yet" : "No threads in this view yet"}
              description={
                isGeneralCommunity
                  ? "Try clearing your search or create the first thread."
                  : "Try a different thread type or clear your search."
              }
              className="bg-[color:var(--surface-elevated)] p-8 shadow-none"
              dashed
            />
          )}

          {loadState === "ready" && threads.length > 0 && (
            <div className="grid gap-3">
              {threads.map((thread) => {
                const href = buildThreadHref(thread.id, {
                  source: isGeneralCommunity ? "community-general" : "community",
                  communityTeamId: isGeneralCommunity ? null : teamId,
                });
                if (!isGeneralCommunity && thread.type === "MATCH") {
                  return <MatchThreadCard key={thread.id} thread={thread} href={href} />;
                }
                return (
                  <TeamThreadCard
                    key={thread.id}
                    thread={thread}
                    href={href}
                    label={isGeneralCommunity ? "General Thread" : "Team Thread"}
                  />
                );
              })}
            </div>
          )}

          {loadState === "ready" && threads.length > 0 && (
            <div className="space-y-3">
              {hasMore ? (
                <>
                  <div ref={loadMoreAnchorRef} className="h-1 w-full" aria-hidden />
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-4 text-center">
                    <p className="text-xs text-[color:var(--muted-foreground)]">
                      Showing {threads.length} of {total} threads
                    </p>
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="btn-secondary min-w-[180px] justify-center disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loadingMore ? "Loading more..." : "Load more threads"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-center text-sm text-[color:var(--muted-foreground)]">
                  You have reached the end of this community feed.
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="xl:sticky xl:top-24">
          {team ? (
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
                <Star className="h-3.5 w-3.5" />
                {isGeneralCommunity ? "League Hub" : "Community Team"}
              </div>

              <h2 className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
                {isGeneralCommunity ? "Premier League General" : team.name}
              </h2>
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                {isGeneralCommunity
                  ? "You are browsing the league-wide community feed for general discussion threads."
                  : "You are browsing this club's dedicated community feed with team and match threads."}
              </p>

              <ul className="mt-4 space-y-2 text-sm text-[color:var(--muted-foreground)]">
                {isGeneralCommunity ? (
                  <>
                    <li className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-sky-500" />
                      {displayedGeneralCount} general discussion threads
                    </li>
                    <li className="flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-sky-500" />
                      No match-thread feed in this community
                    </li>
                  </>
                ) : (
                  <>
                    <li className="flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-sky-500" />
                      {summary.MATCH} match threads in this community
                    </li>
                    <li className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-sky-500" />
                      {summary.TEAM} team discussion threads
                    </li>
                  </>
                )}
              </ul>

              <div className="mt-4 flex flex-col gap-2">
                {isGeneralCommunity ? (
                  <>
                    <Link href="/discussions" className="btn-secondary justify-between">
                      Open Discussions
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href="/matches" className="btn-secondary justify-between">
                      View Fixtures
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href={`/matches?teamId=${team.id}`} className="btn-secondary justify-between">
                      View Team Matches
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href={`/teams/${team.id}`} className="btn-secondary justify-between">
                      Open Team Page
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 text-sm text-[color:var(--muted-foreground)] shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
              Loading community panel...
            </div>
          )}
        </aside>
      </div>

      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="fixed bottom-6 right-6 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-white shadow-[0_14px_34px_rgba(2,132,199,0.45)] transition hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        aria-label={isGeneralCommunity ? "Create general thread" : "Create team thread"}
        title={isGeneralCommunity ? "Create general thread" : "Create team thread"}
      >
        <PencilLine className="h-5 w-5" />
      </button>

      {composerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
          onClick={closeComposer}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={isGeneralCommunity ? "Create general thread" : "Create team thread"}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_20px_52px_rgba(2,8,23,0.35)] sm:max-h-[86vh] sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-[color:var(--foreground)]">
                  {isGeneralCommunity ? "Create General Thread" : "Create Team Thread"}
                </h2>
                <p className="text-sm text-[color:var(--muted-foreground)]">
                  {isGeneralCommunity
                    ? "Posting to Premier League General"
                    : team
                      ? `Posting to ${team.name} community`
                      : "Posting to this community"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeComposer}
                disabled={composerPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Close thread composer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {!session ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-4 text-sm text-[color:var(--foreground)]">
                    Sign in to create a thread in this community.
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Link href={loginHref} className="btn-primary justify-center sm:justify-start">
                      Sign In
                    </Link>
                    <Link href="/register" className="btn-secondary justify-center sm:justify-start">
                      Create Account
                    </Link>
                  </div>
                </div>
              ) : (
                <ThreadComposerForm
                  draft={composer}
                  onChange={setComposer}
                  disabled={composerPending}
                  tagsPlaceholder={
                    isGeneralCommunity
                      ? "analysis, title-race, transfers"
                      : "transfers, tactics, matchday"
                  }
                  pollQuestionPlaceholder={
                    isGeneralCommunity
                      ? "Who has been the league's best signing?"
                      : "Who was the best player on the pitch?"
                  }
                  errorMessage={composerError}
                  onCancel={closeComposer}
                  onSubmit={() => void handleCreateTeamThread()}
                  submitLabel="Create Thread"
                  pendingLabel="Publishing..."
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
