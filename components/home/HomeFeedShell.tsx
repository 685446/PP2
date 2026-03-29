"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  LoaderCircle,
  PencilLine,
  Quote,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trophy,
  X,
} from "lucide-react";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import FeedCard from "@/components/home/FeedCard";
import { GUEST_FEED_ITEMS, PREVIEW_FEED_ITEMS, PREVIEW_NON_MATCH_FEED_ITEMS } from "@/components/home/feedData";
import { normalizeFeedItems, type ApiFeedResponse } from "@/components/home/feedMapper";
import type { FeedItemType, HomeFeedItem } from "@/components/home/types";
import ThreadComposerForm from "@/components/shared/ThreadComposerForm";
import { EmptyStateCard, ErrorStateCard, LoadingStateList } from "@/components/shared/StateBlocks";
import { buildThreadHref } from "@/lib/threadLinks";
import {
  getDefaultPollDeadline,
  INITIAL_THREAD_COMPOSER_CORE_STATE,
  normalizePollOptions,
  normalizeThreadTags,
  type ThreadComposerCoreState,
} from "@/components/shared/threadComposerUtils";

type FavoriteTeamState = {
  teamName: string | null;
  isLoading: boolean;
  error: string | null;
};

type FeedState = {
  items: HomeFeedItem[];
  status: "idle" | "loading" | "ready" | "error";
  errorMessage: string | null;
  page: number;
  totalPages: number;
};

type DigestSections = {
  topDiscussions: string;
  recordedMatches: string;
  standings: string;
  standingsBreakdown?: {
    titleRace: string | null;
    topFourRace: string | null;
    relegationRace: string | null;
  };
};

type DigestState = {
  status: "idle" | "loading" | "ready" | "error";
  digest: string | null;
  digestSections: DigestSections | null;
  generatedAt: string | null;
  errorMessage: string | null;
};

type HomeComposerState = ThreadComposerCoreState;

const INITIAL_TEAM_STATE: FavoriteTeamState = {
  teamName: null,
  isLoading: false,
  error: null,
};

const INITIAL_FEED_STATE: FeedState = {
  items: [],
  status: "idle",
  errorMessage: null,
  page: 1,
  totalPages: 1,
};

const INITIAL_DIGEST_STATE: DigestState = {
  status: "idle",
  digest: null,
  digestSections: null,
  generatedAt: null,
  errorMessage: null,
};

const INITIAL_HOME_COMPOSER_STATE: HomeComposerState = INITIAL_THREAD_COMPOSER_CORE_STATE;

type HomeActivityFilterValue = FeedItemType | "posts";

const HOME_ACTIVITY_FILTER_OPTIONS: Array<{ value: HomeActivityFilterValue; label: string }> = [
  { value: "reply", label: "Replies" },
  { value: "following", label: "Following" },
  { value: "team-update", label: "Team Updates" },
  { value: "posts", label: "Posts" },
];

const HOME_ALL_ACTIVITY_TYPES = HOME_ACTIVITY_FILTER_OPTIONS.map(
  (option) => option.value
) as HomeActivityFilterValue[];

function formatDigestTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHomeActivityFilterLabel(selectedTypes: HomeActivityFilterValue[]) {
  if (selectedTypes.length === HOME_ALL_ACTIVITY_TYPES.length) {
    return "All activity";
  }

  if (selectedTypes.length === 1) {
    return HOME_ACTIVITY_FILTER_OPTIONS.find((option) => option.value === selectedTypes[0])?.label || "Activity";
  }

  const selectedLabels = HOME_ACTIVITY_FILTER_OPTIONS.filter((option) =>
    selectedTypes.includes(option.value)
  ).map((option) => option.label);

  if (selectedLabels.length === 2) {
    return selectedLabels.join(" + ");
  }

  return `${selectedLabels[0]} +${selectedLabels.length - 1}`;
}

function SignedOutMyTeamCard() {
  return (
    <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
        <Star className="h-3.5 w-3.5" />
        My Team
      </div>

      <h2 className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">Personalized team updates are locked</h2>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
        Sign in to follow your favorite team and get match updates, thread activity, and standings changes in one place.
      </p>
    </div>
  );
}

function SignedInNoFavoriteTeamCard() {
  return (
    <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
        <Star className="h-3.5 w-3.5" />
        My Team
      </div>

      <h2 className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">No favorite team selected yet</h2>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
        Pick your club in profile settings to unlock personalized updates on this panel.
      </p>

      <Link href="/settings?tab=profile" className="btn-secondary mt-4">
        Open Profile Settings
      </Link>
    </div>
  );
}

function SignedInFavoriteTeamCard({
  teamName,
  favoriteTeamId,
}: {
  teamName: string;
  favoriteTeamId: number;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
        <Star className="h-3.5 w-3.5" />
        My Team
      </div>

      <h2 className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">{teamName}</h2>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
        You will see your team-focused activity here first: fresh fixtures, results, and conversation spikes.
      </p>

      <ul className="mt-4 space-y-2 text-sm text-[color:var(--muted-foreground)]">
        <li className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-sky-500" />
          Latest fixtures and scores
        </li>
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-sky-500" />
          New thread activity in your team community
        </li>
      </ul>

      <div className="mt-4 flex flex-col gap-2">
        <Link href={`/matches?teamId=${favoriteTeamId}`} className="btn-secondary justify-between">
          View Team Matches
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href={`/communities/${favoriteTeamId}`} className="btn-secondary justify-between">
          Open Team Community
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function DailyDigestCard({
  isAuthenticated,
  digestState,
}: {
  isAuthenticated: boolean;
  digestState: DigestState;
}) {
  if (!isAuthenticated) {
    return (
      <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
          <Sparkles className="h-3.5 w-3.5" />
          Daily Digest
        </div>
        <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">
          Sign in to read your AI-powered daily league digest.
        </p>
      </div>
    );
  }

  const generatedAtLabel = formatDigestTimestamp(digestState.generatedAt);

  return (
    <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
        <Sparkles className="h-3.5 w-3.5" />
        Daily Digest
      </div>

      {digestState.status === "loading" && !digestState.digest && (
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-[color:var(--surface-elevated)]" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-[color:var(--surface-elevated)]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-[color:var(--surface-elevated)]" />
        </div>
      )}

      {digestState.status === "error" && !digestState.digest && (
        <div className="mt-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {digestState.errorMessage || "Could not load digest right now."}
        </div>
      )}

      {digestState.digestSections ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-500">
              Top Discussions
            </p>
            <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
              {digestState.digestSections.topDiscussions}
            </p>
          </div>

          <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-500">
              Recorded Matches
            </p>
            <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
              {digestState.digestSections.recordedMatches}
            </p>
          </div>

          <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-500">
              Standings Update
            </p>
            {digestState.digestSections.standingsBreakdown &&
            (digestState.digestSections.standingsBreakdown.titleRace ||
              digestState.digestSections.standingsBreakdown.topFourRace ||
              digestState.digestSections.standingsBreakdown.relegationRace) ? (
              <div className="mt-1 space-y-2 text-sm leading-6 text-[color:var(--foreground)]">
                {digestState.digestSections.standingsBreakdown.titleRace && (
                  <p>
                    <span className="font-semibold text-sky-500">Title Race:</span>{" "}
                    {digestState.digestSections.standingsBreakdown.titleRace}
                  </p>
                )}
                {digestState.digestSections.standingsBreakdown.topFourRace && (
                  <p>
                    <span className="font-semibold text-sky-500">Top 4:</span>{" "}
                    {digestState.digestSections.standingsBreakdown.topFourRace}
                  </p>
                )}
                {digestState.digestSections.standingsBreakdown.relegationRace && (
                  <p>
                    <span className="font-semibold text-sky-500">Relegation:</span>{" "}
                    {digestState.digestSections.standingsBreakdown.relegationRace}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
                {digestState.digestSections.standings}
              </p>
            )}
          </div>
        </div>
      ) : digestState.digest ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[color:var(--foreground)]">
          {digestState.digest}
        </p>
      ) : null}

      {digestState.status === "error" && digestState.digest && (
        <p className="mt-3 text-xs text-rose-300">
          {digestState.errorMessage || "Could not refresh digest. Showing latest available summary."}
        </p>
      )}

      <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
        {generatedAtLabel ? `Generated ${generatedAtLabel}` : "Generated from latest league activity."}
      </p>
    </div>
  );
}

function FeedComposerPromptCard({
  isAuthenticated,
  onOpenComposer,
}: {
  isAuthenticated: boolean;
  onOpenComposer: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpenComposer}
      className="group relative w-full overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 text-left shadow-[0_10px_26px_rgba(2,8,23,0.12)] transition hover:border-sky-500/50 hover:shadow-[0_16px_36px_rgba(2,132,199,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
      aria-label="Open create thread composer"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(14,165,233,0.18),transparent_55%),radial-gradient(circle_at_100%_100%,rgba(56,189,248,0.14),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-45 [html[data-theme='light']_&]:opacity-25 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.08)_0_16px,rgba(255,255,255,0)_16px_32px)]" />
      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
          <Quote className="h-3.5 w-3.5" />
          Quick Post
        </div>
        <h2 className="mt-3 text-xl font-bold text-[color:var(--foreground)]">Share your matchday take</h2>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          {isAuthenticated
            ? "Drop a fresh thread straight from Home and kick off the conversation."
            : "Sign in to create threads, post replies, and join live matchday conversations."}
        </p>

        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 transition group-hover:border-sky-500/45">
          <p className="text-sm text-[color:var(--muted-foreground)]">
            {isAuthenticated ? "What are your predictions for this weekend?" : "Tap to sign in and start posting your own threads."}
          </p>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-[0_10px_20px_rgba(2,132,199,0.28)]">
            <PencilLine className="h-4.5 w-4.5" />
          </span>
        </div>
      </div>
    </button>
  );
}

function FeedSkeletonList() {
  return (
    <LoadingStateList
      count={3}
      containerClassName="space-y-4"
      itemKeyPrefix="feed-skeleton"
      renderItem={() => (
        <div className="animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
          <div className="h-6 w-28 rounded-full bg-[color:var(--surface-elevated)]" />
          <div className="mt-4 h-6 w-3/5 rounded bg-[color:var(--surface-elevated)]" />
          <div className="mt-3 h-4 w-11/12 rounded bg-[color:var(--surface-elevated)]" />
          <div className="mt-2 h-4 w-8/12 rounded bg-[color:var(--surface-elevated)]" />
        </div>
      )}
    />
  );
}

function FeedEmptyState({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <EmptyStateCard
      title="Feed is quiet right now"
      description={
        isAuthenticated
          ? "No fresh feed events yet. As new replies and team updates arrive, they will appear here."
          : "Sign in to unlock your personalized stream."
      }
    />
  );
}

function FeedPreviewBanner() {
  return (
    <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
      No live feed events yet. Showing preview cards so you can review the design.
    </div>
  );
}

function FeedPreviewSecondaryBanner() {
  return (
    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
      Showing additional mock discussion cards (non-match) so you can review their design.
    </div>
  );
}

function FeedErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ErrorStateCard
      title="Could not load your feed"
      message={message}
      onRetry={onRetry}
      className="p-5 text-sm text-red-200"
      titleClassName="text-base font-semibold"
      messageClassName="opacity-90 text-red-200"
    />
  );
}

function FeedEndState({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-5 py-4 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-500">
          <CheckCheck className="h-4.5 w-4.5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-[color:var(--foreground)]">You reached the end of your feed</p>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            {isAuthenticated
              ? "You are all caught up for now."
              : "Sign in to unlock your personalized feed updates."}
          </p>
        </div>
      </div>

      <div className="mt-3 h-px w-full bg-[color:var(--surface-border)]" />

      <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
        {isAuthenticated
          ? "New match and discussion activity will appear here automatically."
          : "Create an account to follow teams, threads, and match updates."}
      </p>
    </div>
  );
}

function FeedLoadMore({
  loading,
  onLoadMore,
}: {
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className="inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-500 transition hover:border-sky-500/45 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Loading more..." : "Load More Activity"}
      </button>
    </div>
  );
}

export default function HomeFeedShell() {
  const router = useRouter();
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [favoriteTeam, setFavoriteTeam] = useState<FavoriteTeamState>(INITIAL_TEAM_STATE);
  const [feedState, setFeedState] = useState<FeedState>(INITIAL_FEED_STATE);
  const [digestState, setDigestState] = useState<DigestState>(INITIAL_DIGEST_STATE);
  const [isActivityMenuOpen, setIsActivityMenuOpen] = useState(false);
  const [selectedActivityTypes, setSelectedActivityTypes] = useState<HomeActivityFilterValue[]>(HOME_ALL_ACTIVITY_TYPES);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPending, setComposerPending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composer, setComposer] = useState<HomeComposerState>({
    ...INITIAL_HOME_COMPOSER_STATE,
    pollDeadline: getDefaultPollDeadline(),
  });
  const [retryNonce, setRetryNonce] = useState(0);
  const [digestPollTick, setDigestPollTick] = useState(0);
  const [loadingMoreFeed, setLoadingMoreFeed] = useState(false);
  const activityMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncSession = () => {
      setSession(loadAuthSession());
    };

    syncSession();
    window.addEventListener(AUTH_CHANGED_EVENT, syncSession);
    window.addEventListener("storage", syncSession);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  useEffect(() => {
    if (!isActivityMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!activityMenuRef.current || !target) return;
      if (!activityMenuRef.current.contains(target)) {
        setIsActivityMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsActivityMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isActivityMenuOpen]);

  const favoriteTeamId = session?.user.favoriteTeamId ?? null;

  useEffect(() => {
    if (!favoriteTeamId) {
      setFavoriteTeam(INITIAL_TEAM_STATE);
      return;
    }

    const controller = new AbortController();
    setFavoriteTeam({ teamName: null, isLoading: true, error: null });

    const loadTeamName = async () => {
      try {
        const response = await fetch(`/api/teams/${favoriteTeamId}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("team_lookup_failed");
        }

        const team = (await response.json()) as { name?: string };
        setFavoriteTeam({
          teamName: team.name ?? `Team #${favoriteTeamId}`,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setFavoriteTeam({
          teamName: `Team #${favoriteTeamId}`,
          isLoading: false,
          error: error instanceof Error ? error.message : "team_lookup_failed",
        });
      }
    };

    void loadTeamName();

    return () => controller.abort();
  }, [favoriteTeamId]);

  const fetchFeed = useCallback(async (
    currentSession: StoredAuthSession,
    signal: AbortSignal,
    page = 1
  ) => {
    const refreshed = await refreshAccessTokenIfNeeded();
    const resolvedSession = refreshed ?? currentSession;
    const accessToken = resolvedSession.accessToken;

    const response = await fetch(`/api/feed?limit=25&page=${page}`, {
      method: "GET",
      signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "Feed request failed.");
    }

    const payload = (await response.json()) as ApiFeedResponse & {
      page?: number;
      totalPages?: number;
    };
    return {
      items: normalizeFeedItems(payload),
      page: typeof payload.page === "number" ? payload.page : page,
      totalPages: typeof payload.totalPages === "number" ? payload.totalPages : 1,
    };
  }, []);

  const fetchDigest = useCallback(async (currentSession: StoredAuthSession, signal: AbortSignal) => {
    const refreshed = await refreshAccessTokenIfNeeded();
    const resolvedSession = refreshed ?? currentSession;
    const accessToken = resolvedSession.accessToken;

    const response = await fetch("/api/digest", {
      method: "GET",
      signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "Digest request failed.");
    }

    const payload = (await response.json()) as {
      digest?: string;
      generatedAt?: string;
      digestSections?: Partial<DigestSections>;
    };
    const digestSections =
      payload.digestSections &&
      typeof payload.digestSections.topDiscussions === "string" &&
      typeof payload.digestSections.recordedMatches === "string" &&
      typeof payload.digestSections.standings === "string"
        ? {
            topDiscussions: payload.digestSections.topDiscussions,
            recordedMatches: payload.digestSections.recordedMatches,
            standings: payload.digestSections.standings,
            standingsBreakdown:
              payload.digestSections.standingsBreakdown &&
              typeof payload.digestSections.standingsBreakdown === "object"
                ? {
                    titleRace:
                      typeof payload.digestSections.standingsBreakdown.titleRace === "string"
                        ? payload.digestSections.standingsBreakdown.titleRace
                        : null,
                    topFourRace:
                      typeof payload.digestSections.standingsBreakdown.topFourRace === "string"
                        ? payload.digestSections.standingsBreakdown.topFourRace
                        : null,
                    relegationRace:
                      typeof payload.digestSections.standingsBreakdown.relegationRace === "string"
                        ? payload.digestSections.standingsBreakdown.relegationRace
                        : null,
                  }
                : undefined,
          }
        : null;

    return {
      digest: typeof payload.digest === "string" ? payload.digest : "",
      digestSections,
      generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : null,
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setFeedState({
        items: GUEST_FEED_ITEMS,
        status: "ready",
        errorMessage: null,
        page: 1,
        totalPages: 1,
      });
      return;
    }

    const controller = new AbortController();
    setLoadingMoreFeed(false);
    setFeedState((prev) => ({
      ...prev,
      status: "loading",
      errorMessage: null,
      page: 1,
      totalPages: 1,
    }));

    const loadFeed = async () => {
      try {
        const payload = await fetchFeed(session, controller.signal, 1);
        if (controller.signal.aborted) return;

        setFeedState({
          items: payload.items,
          status: "ready",
          errorMessage: null,
          page: payload.page,
          totalPages: payload.totalPages,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setFeedState({
          items: [],
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Could not load feed.",
          page: 1,
          totalPages: 1,
        });
      }
    };

    void loadFeed();

    return () => controller.abort();
  }, [fetchFeed, retryNonce, session]);

  useEffect(() => {
    if (!session) {
      setDigestState(INITIAL_DIGEST_STATE);
      return;
    }

    const controller = new AbortController();
    setDigestState((current) => ({
      ...current,
      status: "loading",
      errorMessage: null,
    }));

    const loadDigest = async () => {
      try {
        const payload = await fetchDigest(session, controller.signal);
        if (controller.signal.aborted) return;

        setDigestState({
          status: "ready",
          digest: payload.digest,
          digestSections: payload.digestSections,
          generatedAt: payload.generatedAt,
          errorMessage: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setDigestState((current) => ({
          ...current,
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Could not load digest.",
        }));
      }
    };

    void loadDigest();

    return () => controller.abort();
  }, [digestPollTick, fetchDigest, session]);

  useEffect(() => {
    if (!session) return;
    const intervalId = window.setInterval(() => {
      setDigestPollTick((current) => current + 1);
    }, 30 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [session]);

  useEffect(() => {
    if (!composerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !composerPending) {
        setComposerOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composerOpen, composerPending]);

  const sortedItems = useMemo(
    () => [...feedState.items].sort((a, b) => b.createdAtMs - a.createdAtMs),
    [feedState.items]
  );
  const selectedActivitySet = useMemo(
    () => new Set<HomeActivityFilterValue>(selectedActivityTypes),
    [selectedActivityTypes]
  );
  const isAllActivitySelected = selectedActivityTypes.length === HOME_ALL_ACTIVITY_TYPES.length;
  const activityFilterLabel = useMemo(
    () => formatHomeActivityFilterLabel(selectedActivityTypes),
    [selectedActivityTypes]
  );
  const isItemVisibleForFilters = useCallback(
    (item: HomeFeedItem) => {
      if (!selectedActivitySet.has(item.type)) return false;
      if (!selectedActivitySet.has("posts") && item.originKind === "post") return false;
      return true;
    },
    [selectedActivitySet]
  );

  const showPreviewCards = Boolean(session) && feedState.status === "ready" && sortedItems.length === 0;
  const hasMoreFeedPages =
    Boolean(session) &&
    feedState.status === "ready" &&
    feedState.page < feedState.totalPages &&
    !showPreviewCards;
  const baseDisplayItems = showPreviewCards ? PREVIEW_FEED_ITEMS : sortedItems;
  const displayItems = useMemo(
    () => baseDisplayItems.filter((item) => isItemVisibleForFilters(item)),
    [baseDisplayItems, isItemVisibleForFilters]
  );
  const filteredPreviewNonMatchItems = useMemo(
    () => PREVIEW_NON_MATCH_FEED_ITEMS.filter((item) => isItemVisibleForFilters(item)),
    [isItemVisibleForFilters]
  );
  const showNonMatchPreviewCards =
    Boolean(session) &&
    feedState.status === "ready" &&
    sortedItems.length > 0 &&
    sortedItems.every((item) => item.type === "team-update") &&
    filteredPreviewNonMatchItems.length > 0;
  const showFilterEmptyState =
    feedState.status === "ready" &&
    !showPreviewCards &&
    sortedItems.length > 0 &&
    displayItems.length === 0 &&
    !showNonMatchPreviewCards;
  const loginHref = `/login?next=${encodeURIComponent("/")}`;

  const handleLoadMoreFeed = useCallback(async () => {
    if (!session || loadingMoreFeed || feedState.status !== "ready") {
      return;
    }
    if (feedState.page >= feedState.totalPages) {
      return;
    }

    setLoadingMoreFeed(true);

    try {
      const payload = await fetchFeed(session, new AbortController().signal, feedState.page + 1);
      setFeedState((current) => {
        const seenIds = new Set(current.items.map((item) => item.id));
        const appendedItems = payload.items.filter((item) => !seenIds.has(item.id));

        return {
          ...current,
          items: [...current.items, ...appendedItems],
          page: payload.page,
          totalPages: payload.totalPages,
          errorMessage: null,
        };
      });
    } catch (error) {
      setFeedState((current) => ({
        ...current,
        errorMessage: error instanceof Error ? error.message : "Could not load more feed items.",
      }));
    } finally {
      setLoadingMoreFeed(false);
    }
  }, [feedState.page, feedState.status, feedState.totalPages, fetchFeed, loadingMoreFeed, session]);

  const resetComposer = useCallback(() => {
    setComposer({
      ...INITIAL_HOME_COMPOSER_STATE,
      pollDeadline: getDefaultPollDeadline(),
    });
    setComposerError(null);
  }, []);

  const closeComposer = useCallback(() => {
    if (composerPending) return;
    setComposerOpen(false);
  }, [composerPending]);

  const resetActivityFilter = useCallback(() => {
    setSelectedActivityTypes(HOME_ALL_ACTIVITY_TYPES);
  }, []);

  const toggleActivityType = useCallback((type: HomeActivityFilterValue) => {
    setSelectedActivityTypes((current) => {
      const hasType = current.includes(type);
      if (hasType) {
        if (current.length === 1) return current;
        return current.filter((entry) => entry !== type);
      }
      return HOME_ACTIVITY_FILTER_OPTIONS
        .map((option) => option.value)
        .filter((optionType) => optionType === type || current.includes(optionType));
    });
  }, []);

  const handleCreateThread = useCallback(async () => {
    setComposerError(null);
    setComposerPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to create a thread.");
      }

      const trimmedTitle = composer.title.trim();
      const trimmedBody = composer.body.trim();
      if (!trimmedTitle) {
        throw new Error("Add a title before publishing.");
      }
      if (!trimmedBody) {
        throw new Error("Add some context in the thread body.");
      }

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
          type: "GENERAL",
          ...(normalizedTags.length > 0 ? { tags: normalizedTags } : {}),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not create thread.");
      }

      if (!payload.id) {
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

        const pollResponse = await fetch(`/api/threads/${payload.id}/polls`, {
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

      const threadId = payload.id;
      resetComposer();
      setComposerOpen(false);
      setRetryNonce((current) => current + 1);
      setDigestPollTick((current) => current + 1);
      router.push(
        buildThreadHref(threadId, {
          source: "community-general",
        })
      );
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not create thread.");
    } finally {
      setComposerPending(false);
    }
  }, [composer, resetComposer, router]);

  return (
    <section className="space-y-6">
      <div className="mx-auto w-full max-w-[1240px]">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,760px)_320px] xl:justify-center">
          <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div ref={activityMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsActivityMenuOpen((open) => !open)}
                aria-expanded={isActivityMenuOpen}
                aria-haspopup="menu"
                className="inline-flex h-11 min-w-[230px] items-center justify-between rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 text-sm text-[color:var(--foreground)] shadow-[0_8px_20px_rgba(2,8,23,0.06)] transition hover:bg-[color:var(--surface-elevated)]"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 shrink-0 text-sky-500" />
                  <span className="text-[color:var(--muted-foreground)]">Filter</span>
                  <span className="truncate font-semibold text-[color:var(--foreground)]">{activityFilterLabel}</span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-[color:var(--muted-foreground)] transition-transform ${
                    isActivityMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isActivityMenuOpen && (
                <div className="absolute left-0 top-full z-30 mt-2 w-[280px] overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_24px_rgba(2,8,23,0.16)]">
                  <div className="max-h-72 overflow-auto p-1.5">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={isAllActivitySelected}
                      onClick={resetActivityFilter}
                      className={`inline-flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                        isAllActivitySelected
                          ? "bg-sky-500/20 font-semibold text-sky-400"
                          : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                      }`}
                    >
                      <span>All activity</span>
                      {isAllActivitySelected ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                    </button>

                    <div className="my-1 h-px w-full bg-[color:var(--surface-border)]" />

                    {HOME_ACTIVITY_FILTER_OPTIONS.map((option) => {
                      const isSelected = selectedActivitySet.has(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={isSelected}
                          onClick={() => toggleActivityType(option.value)}
                          className={`inline-flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                            isSelected
                              ? "bg-sky-500/20 font-semibold text-sky-400"
                              : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-elevated)]"
                          }`}
                        >
                          <span>{option.label}</span>
                          {isSelected ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <FeedComposerPromptCard isAuthenticated={Boolean(session)} onOpenComposer={() => setComposerOpen(true)} />

          {feedState.status === "loading" && <FeedSkeletonList />}

          {feedState.status === "error" && (
            <FeedErrorState
              message={feedState.errorMessage || "Could not load feed."}
              onRetry={() => setRetryNonce((current) => current + 1)}
            />
          )}

          {feedState.status === "ready" && sortedItems.length === 0 && (
            <FeedEmptyState isAuthenticated={Boolean(session)} />
          )}

          {showPreviewCards && <FeedPreviewBanner />}

          {feedState.status === "ready" &&
            displayItems.length > 0 &&
            displayItems.map((item) => <FeedCard key={item.id} item={item} />)}

          {showNonMatchPreviewCards && (
            <>
              <FeedPreviewSecondaryBanner />
              {filteredPreviewNonMatchItems.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </>
          )}

          {showFilterEmptyState && <FeedFilterEmptyState onReset={resetActivityFilter} />}

          {hasMoreFeedPages && (
            <FeedLoadMore loading={loadingMoreFeed} onLoadMore={() => void handleLoadMoreFeed()} />
          )}

          {feedState.status === "ready" &&
            !hasMoreFeedPages &&
            (displayItems.length > 0 || showNonMatchPreviewCards) && (
            <FeedEndState isAuthenticated={Boolean(session)} />
          )}
          </div>

          <aside className="xl:sticky xl:top-24">
            {!session && <SignedOutMyTeamCard />}

            {session && !favoriteTeamId && <SignedInNoFavoriteTeamCard />}

            {session && favoriteTeamId && favoriteTeam.isLoading && (
              <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 text-sm text-[color:var(--muted-foreground)] shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
                Loading your team panel...
              </div>
            )}

            {session && favoriteTeamId && !favoriteTeam.isLoading && favoriteTeam.teamName && (
              <SignedInFavoriteTeamCard teamName={favoriteTeam.teamName} favoriteTeamId={favoriteTeamId} />
            )}

            {session && favoriteTeam.error && (
              <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                Team data is partially available. You can still open matches and your community.
              </p>
            )}

            <DailyDigestCard
              isAuthenticated={Boolean(session)}
              digestState={digestState}
            />
          </aside>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="fixed bottom-6 right-6 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-white shadow-[0_14px_34px_rgba(2,132,199,0.45)] transition hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        aria-label="Create thread"
        title="Create thread"
      >
        <PencilLine className="h-5 w-5" />
      </button>

      {composerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]"
          onClick={closeComposer}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create thread"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_20px_52px_rgba(2,8,23,0.35)]"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-[color:var(--foreground)]">Create Thread</h2>
                <p className="text-sm text-[color:var(--muted-foreground)]">Posting to Premier League General</p>
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

            <div className="max-h-[80vh] overflow-auto px-5 py-4">
              {!session ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-4 text-sm text-[color:var(--foreground)]">
                    Sign in to create a thread from Home.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link href={loginHref} className="btn-primary">
                      Sign In
                    </Link>
                    <Link href="/register" className="btn-secondary">
                      Create Account
                    </Link>
                  </div>
                </div>
              ) : (
                <ThreadComposerForm
                  draft={composer}
                  onChange={setComposer}
                  disabled={composerPending}
                  tagsPlaceholder="analysis, title-race, transfers"
                  pollQuestionPlaceholder="Who has been the league's best signing?"
                  errorMessage={composerError}
                  onCancel={closeComposer}
                  onSubmit={() => void handleCreateThread()}
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

function FeedFilterEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <EmptyStateCard
      title="No cards for this filter"
      description="Try enabling more activity types to see your full feed."
      action={
        <button type="button" onClick={onReset} className="btn-secondary">
          Reset to All Activity
        </button>
      }
    />
  );
}
