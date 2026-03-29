"use client";

import Link from "next/link";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import { SYSTEM_USER_BADGE, SYSTEM_USER_BIO, isSystemUsername } from "@/lib/systemUser";
import {
  ChevronDown,
  Lock,
  MessageSquare,
  PencilLine,
  RefreshCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import {
  Dispatch,
  SetStateAction,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
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

type ThreadTag = {
  tag: {
    id: number;
    name: string;
  };
};

type ThreadAuthor = {
  id: number;
  username: string;
  avatar: string;
};

type ThreadTeam = {
  id: number;
  name: string;
  crestUrl: string | null;
} | null;

type TeamOption = {
  id: number;
  name: string;
  crestUrl: string | null;
};

type ThreadRecord = {
  id: number;
  title: string;
  body: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: string;
  updatedAt: string;
  openAt: string;
  closedAt: string | null;
  author: ThreadAuthor;
  team: ThreadTeam;
  tags: ThreadTag[];
  _count: {
    posts: number;
  };
};

type ThreadsResponse = {
  threads: ThreadRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: {
    distinctTags: number;
    byType: {
      GENERAL: number;
      TEAM: number;
      MATCH: number;
    };
  };
};

type FilterDraft = {
  title: string;
  author: string;
  team: string;
  tags: string;
  type: "ALL" | "GENERAL" | "TEAM" | "MATCH";
};

type AppliedFilters = FilterDraft;
type PageAction = "prev" | "next" | "jump" | null;
type ThreadComposer = ThreadComposerCoreState & {
  type: "GENERAL" | "TEAM";
  teamId: string;
};

const INITIAL_FILTERS: AppliedFilters = {
  title: "",
  author: "",
  team: "",
  tags: "",
  type: "ALL",
};

const TYPE_OPTIONS: AppliedFilters["type"][] = ["ALL", "GENERAL", "TEAM", "MATCH"];
const PAGE_SIZE = 10;
const INITIAL_SUMMARY = {
  distinctTags: 0,
  byType: {
    GENERAL: 0,
    TEAM: 0,
    MATCH: 0,
  },
};

const INITIAL_COMPOSER: ThreadComposer = {
  ...INITIAL_THREAD_COMPOSER_CORE_STATE,
  type: "GENERAL",
  teamId: "",
};

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isClosedMatchThread(thread: ThreadRecord) {
  if (thread.type !== "MATCH" || !thread.closedAt) {
    return false;
  }

  const closedAt = new Date(thread.closedAt);
  return !Number.isNaN(closedAt.getTime()) && closedAt.getTime() <= Date.now();
}

function getThreadFeedTimestamp(thread: ThreadRecord) {
  return formatRelativeDate(thread.openAt || thread.createdAt);
}

function getThreadLifecycleSummary(thread: ThreadRecord) {
  if (thread.type !== "MATCH") {
    return null;
  }

  const openedAt = formatDateTime(thread.openAt);
  const closedAt = formatDateTime(thread.closedAt);

  if (isClosedMatchThread(thread)) {
    return `Opened ${openedAt ?? "unknown"} · Closed ${closedAt ?? "unknown"}`;
  }

  return `Opened ${openedAt ?? "unknown"} · Closes ${closedAt ?? "unknown"}`;
}

function isSystemThreadAuthor(thread: ThreadRecord) {
  return isSystemUsername(thread.author.username);
}

function buildActiveFilterChips(
  filters: AppliedFilters,
  currentUsername?: string | null
) {
  const chips: { key: string; label: string }[] = [];
  const normalizedCurrentUsername = currentUsername?.trim().toLowerCase() ?? null;
  const normalizedAuthor = filters.author.trim().toLowerCase();

  if (filters.type !== "ALL") {
    chips.push({ key: "type", label: `Type: ${filters.type}` });
  }

  if (filters.title.trim()) {
    chips.push({ key: "title", label: `Title: ${filters.title.trim()}` });
  }

  if (filters.author.trim()) {
    chips.push({
      key: "author",
      label:
        normalizedCurrentUsername && normalizedAuthor === normalizedCurrentUsername
          ? "My Content"
          : `Author: ${filters.author.trim()}`,
    });
  }

  if (filters.team.trim()) {
    chips.push({ key: "team", label: `Team: ${filters.team.trim()}` });
  }

  filters.tags
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((tag) => {
      chips.push({ key: `tag-${tag}`, label: `Tag: ${tag}` });
    });

  return chips;
}

function buildEmptyStateTitle(filters: AppliedFilters) {
  if (filters.type !== "ALL") {
    return `No ${filters.type} threads found for these filters.`;
  }

  return "No threads match those filters yet.";
}

function buildEmptyStateDescription(filters: AppliedFilters) {
  if (filters.type !== "ALL") {
    return "Try widening the selected type or clearing one of the other filters to reopen the feed.";
  }

  return "Try loosening the title, author, team, or tag filters to widen the feed.";
}

function buildThreadsUrl(filters: AppliedFilters, page: number) {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("page", String(page));

  if (filters.type !== "ALL") {
    params.set("type", filters.type);
  }

  if (filters.title.trim()) {
    params.set("title", filters.title.trim());
  }

  if (filters.author.trim()) {
    params.set("author", filters.author.trim());
  }

  if (filters.team.trim()) {
    params.set("team", filters.team.trim());
  }

  if (filters.tags.trim()) {
    params.set("tags", filters.tags.trim());
  }

  return `/api/threads?${params.toString()}`;
}

async function fetchThreads(filters: AppliedFilters, page: number) {
  const response = await fetch(buildThreadsUrl(filters, page), {
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to load discussions");
  }

  return (await response.json()) as ThreadsResponse;
}

async function fetchTeams() {
  const response = await fetch("/api/teams", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load teams");
  }

  const payload = (await response.json()) as { data?: TeamOption[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

function DiscussionsComposerPanel({
  session,
  loginHref,
  communityScopedCompose,
  scopedTeamLabel,
  composer,
  setComposer,
  composerPending,
  composerError,
  teams,
  teamsLoading,
  teamsError,
  submitThread,
}: {
  session: StoredAuthSession | null;
  loginHref: string;
  communityScopedCompose: boolean;
  scopedTeamLabel: string;
  composer: ThreadComposer;
  setComposer: Dispatch<SetStateAction<ThreadComposer>>;
  composerPending: boolean;
  composerError: string | null;
  teams: TeamOption[];
  teamsLoading: boolean;
  teamsError: string | null;
  submitThread: () => Promise<void>;
}) {
  return (
    <div className="rounded-[24px] border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-sky-500/10 p-2 text-sky-600">
          <PencilLine className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-[color:var(--foreground)]">Start a Thread</h2>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            {communityScopedCompose
              ? "You are creating a thread directly inside this team community."
              : "Create a general discussion or open a team-specific thread from here."}
          </p>
        </div>
      </div>

      {!session ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/8 p-4 text-sm text-[color:var(--foreground)]">
            Sign in to start your own threads.
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
        <div className="mt-4 space-y-4">
          {communityScopedCompose && (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-sm font-semibold text-[color:var(--foreground)]">
              Team thread for {scopedTeamLabel}
            </div>
          )}

          <ThreadComposerForm
            draft={composer}
            onChange={(next) => setComposer(next)}
            onSubmit={() => void submitThread()}
            disabled={composerPending}
            errorMessage={composerError}
            showTypeToggle={!communityScopedCompose}
            threadType={composer.type}
            onThreadTypeChange={(type) =>
              setComposer((current) => ({
                ...current,
                type,
              }))
            }
            showTeamField={communityScopedCompose || composer.type === "TEAM"}
            teamFieldMode={communityScopedCompose ? "locked" : "select"}
            teamLabel="Team"
            teamId={composer.teamId}
            onTeamIdChange={(value) =>
              setComposer((current) => ({
                ...current,
                teamId: value,
              }))
            }
            lockedTeamLabel={scopedTeamLabel}
            teams={teams.map((team) => ({
              id: team.id,
              name: team.name,
            }))}
            teamsLoading={teamsLoading}
            teamsError={teamsError}
            teamSelectPlaceholder="Choose a team"
            tagsPlaceholder="transfers, tactics, matchday"
            bodyRows={5}
            footerRightText="Up to 5 tags"
            submitLabel="Create Thread"
            pendingLabel="Publishing..."
            showCancel={false}
          />
        </div>
      )}
    </div>
  );
}

function DiscussionsFiltersPanel({
  appliedFilters,
  currentPage,
  draftFilters,
  hasActiveFilters,
  loadThreads,
  refreshing,
  resetFilters,
  session,
  setDraftFilters,
  submitFilters,
}: {
  appliedFilters: AppliedFilters;
  currentPage: number;
  draftFilters: FilterDraft;
  hasActiveFilters: boolean;
  loadThreads: (filters: AppliedFilters, page: number, options?: { background?: boolean }) => Promise<void>;
  refreshing: boolean;
  resetFilters: () => void;
  session: StoredAuthSession | null;
  setDraftFilters: Dispatch<SetStateAction<FilterDraft>>;
  submitFilters: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[color:var(--foreground)]">Thread Filters</h2>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">Refine the feed using the real backend query params.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadThreads(appliedFilters, currentPage, { background: true })}
          className="btn-icon"
          aria-label="Refresh discussions"
        >
          <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
          Quick Views
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <button
            type="button"
            onClick={resetFilters}
            className={`rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition ${
              !hasActiveFilters
                ? "border-sky-500 bg-sky-500/10 text-sky-600"
                : "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:border-sky-500/35"
            }`}
          >
            All Discussions
          </button>
          {session ? (
            <Link
              href="/discussions/my-content"
              className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-3 text-left text-sm font-semibold text-[color:var(--foreground)] transition hover:border-sky-500/35"
            >
              My Content
              <span className="mt-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
                View your threads, posts, replies, and polls
              </span>
            </Link>
          ) : (
            <div className="rounded-2xl border border-dashed border-[color:var(--surface-border)] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
              Sign in to use the My Content shortcut.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Title</span>
          <input
            value={draftFilters.title}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Transfer rumours, title race, match thread..."
            className="w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Author</span>
          <input
            value={draftFilters.author}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, author: event.target.value }))
            }
            placeholder="Username"
            className="w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Team</span>
          <input
            value={draftFilters.team}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, team: event.target.value }))
            }
            placeholder="Arsenal, Liverpool, Chelsea..."
            className="w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Tags</span>
          <input
            value={draftFilters.tags}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, tags: event.target.value }))
            }
            placeholder="matchday, tactics, transfers"
            className="w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500"
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Thread Type</p>
        <div className="grid grid-cols-2 gap-2">
          {TYPE_OPTIONS.map((option) => {
            const active = draftFilters.type === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() =>
                  setDraftFilters((current) => ({
                    ...current,
                    type: option,
                  }))
                }
                className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                  active
                    ? "border-sky-500 bg-sky-500/10 text-sky-600"
                    : "border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
                }`}
              >
                {option === "ALL" ? "All Threads" : option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={submitFilters} className="btn-primary">
          <Search className="h-4 w-4" />
          Apply Filters
        </button>
        <button type="button" onClick={resetFilters} className="btn-secondary">
          Clear
        </button>
      </div>
    </>
  );
}

function DiscussionPreviewContent({ selectedThread }: { selectedThread: ThreadRecord | null }) {
  if (!selectedThread) {
    return (
      <EmptyStateCard
        title="Select a thread to preview it here."
        className="flex h-full min-h-[320px] items-center justify-center rounded-2xl bg-[color:var(--surface-elevated)] p-6 shadow-none"
        titleClassName="text-base font-normal text-[color:var(--muted-foreground)]"
        descriptionClassName="hidden"
        dashed
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--foreground)]">
          Active Preview
        </span>
        <span className="text-xs text-[color:var(--muted-foreground)]">Thread #{selectedThread.id}</span>
      </div>

      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-[color:var(--foreground)]">{selectedThread.title}</h2>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--muted-foreground)]">
          {selectedThread.body}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Author</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-[color:var(--foreground)]">{selectedThread.author.username}</p>
            {isSystemThreadAuthor(selectedThread) && (
              <span className="inline-flex items-center rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                {SYSTEM_USER_BADGE}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            Opened {formatDateTime(selectedThread.openAt) ?? formatRelativeDate(selectedThread.openAt)}
          </p>
          {isSystemThreadAuthor(selectedThread) && (
            <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">{SYSTEM_USER_BIO}</p>
          )}
        </div>
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Thread Stats</p>
          <p className="mt-2 text-base font-semibold text-[color:var(--foreground)]">{selectedThread._count.posts} visible posts</p>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            {selectedThread.team ? selectedThread.team.name : "League-wide discussion"}
          </p>
        </div>
      </div>

      {selectedThread.type === "MATCH" && (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            isClosedMatchThread(selectedThread)
              ? "border-amber-500/25 bg-amber-400/10 text-[color:var(--foreground)]"
              : "border-emerald-500/25 bg-emerald-400/10 text-[color:var(--foreground)]"
          }`}
        >
          <p className="font-semibold">
            {isClosedMatchThread(selectedThread)
              ? "This match thread is closed."
              : "This match thread is live."}
          </p>
          <p className="mt-2">
            Opened {formatDateTime(selectedThread.openAt) ?? "unknown"}.
            {selectedThread.closedAt
              ? ` ${isClosedMatchThread(selectedThread) ? "Closed" : "Closes"} ${formatDateTime(selectedThread.closedAt) ?? "unknown"}.`
              : ""}
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Tag Cluster</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedThread.tags.length > 0 ? (
            selectedThread.tags.map(({ tag: threadTag }) => (
              <span
                key={threadTag.id}
                className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--foreground)]"
              >
                {threadTag.name}
              </span>
            ))
          ) : (
            <span className="text-sm text-[color:var(--muted-foreground)]">No tags attached</span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-sky-500/25 bg-sky-500/10 p-4 text-sm text-[color:var(--foreground)]">
        Use Preview for a quick scan, or open the full thread to read posts and replies.
      </div>

      <Link href={buildThreadHref(selectedThread.id, { source: "discussions" })} className="btn-primary w-full justify-center">
        Open Full Thread
      </Link>
    </div>
  );
}

export default function DiscussionsPage() {
  const PREVIEW_PANEL_SCROLL_OFFSET_PX = 132;
  const [queryString, setQueryString] = useState("");
  const queryParams = useMemo(() => new URLSearchParams(queryString), [queryString]);
  const [draftFilters, setDraftFilters] = useState<FilterDraft>({
    title: "",
    author: "",
    team: "",
    tags: "",
    type: "ALL",
  });
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(INITIAL_FILTERS);
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [pageInput, setPageInput] = useState("1");
  const [pageAction, setPageAction] = useState<PageAction>(null);
  const [summary, setSummary] = useState(INITIAL_SUMMARY);
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [composer, setComposer] = useState<ThreadComposer>(INITIAL_COMPOSER);
  const [composerPending, setComposerPending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const composerSectionRef = useRef<HTMLDivElement | null>(null);
  const deferredThreads = useDeferredValue(threads);
  const composeMode = queryParams.get("compose") === "1";
  const composeScope = queryParams.get("scope");
  const communityTeamIdParam = queryParams.get("teamId");
  const communityScopedCompose =
    composeScope === "community" &&
    typeof communityTeamIdParam === "string" &&
    /^\d+$/.test(communityTeamIdParam);
  const scopedTeamId = communityScopedCompose ? Number(communityTeamIdParam) : null;
  const loginNext = `/discussions${queryString ? `?${queryString}` : ""}`;
  const loginHref = `/login?next=${encodeURIComponent(loginNext)}`;

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
    if (typeof window === "undefined") return;
    const updateQuery = () => {
      setQueryString(window.location.search.startsWith("?") ? window.location.search.slice(1) : window.location.search);
    };
    updateQuery();
    window.addEventListener("popstate", updateQuery);
    return () => window.removeEventListener("popstate", updateQuery);
  }, []);

  useEffect(() => {
    setSession(loadAuthSession());

    const syncSession = () => {
      setSession(loadAuthSession());
    };

    window.addEventListener(AUTH_CHANGED_EVENT, syncSession);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, syncSession);
  }, []);

  useEffect(() => {
    if (!composeMode) return;
    const target = composerSectionRef.current;
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [composeMode]);

  useEffect(() => {
    if (!communityScopedCompose || !scopedTeamId) return;
    setComposer((current) => ({
      ...current,
      type: "TEAM",
      teamId: String(scopedTeamId),
    }));
  }, [communityScopedCompose, scopedTeamId]);

  useEffect(() => {
    if (!session?.user) return;

    let cancelled = false;
    setTeamsLoading(true);
    setTeamsError(null);

    void fetchTeams()
      .then((payload) => {
        if (cancelled) return;
        setTeams(payload);
        setComposer((current) => {
          if (current.teamId) return current;
          const favoriteTeamId = session.user.favoriteTeamId;
          if (!favoriteTeamId || !payload.some((team) => team.id === favoriteTeamId)) {
            return current;
          }
          return {
            ...current,
            teamId: String(favoriteTeamId),
          };
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setTeamsError(error instanceof Error ? error.message : "Failed to load teams");
      })
      .finally(() => {
        if (!cancelled) {
          setTeamsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user]);

  async function loadThreads(
    filters: AppliedFilters,
    page: number,
    { background = false } = {}
  ) {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const payload = await fetchThreads(filters, page);

      startTransition(() => {
        setThreads(payload.threads);
        setTotal(payload.total);
        setCurrentPage(payload.page);
        setTotalPages(payload.totalPages);
        setPageSize(payload.limit);
        setPageInput(String(payload.page));
        setSummary(payload.summary);
        setSelectedThreadId((currentId) => {
          if (payload.threads.length === 0) return null;
          if (currentId && payload.threads.some((thread) => thread.id === currentId)) {
            return currentId;
          }
          return payload.threads[0].id;
        });
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load discussions");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setPageAction(null);
    }
  }

  useEffect(() => {
    void loadThreads(appliedFilters, currentPage);
  }, [appliedFilters, currentPage]);

  const selectedThread =
    deferredThreads.find((thread) => thread.id === selectedThreadId) ?? null;
  const scopedTeamOption =
    scopedTeamId !== null ? teams.find((team) => team.id === scopedTeamId) ?? null : null;
  const scopedTeamLabel = scopedTeamOption?.name ?? (scopedTeamId !== null ? `Team #${scopedTeamId}` : "Selected Team");

  const previewThread = (threadId: number) => {
    setSelectedThreadId(threadId);
    requestAnimationFrame(() => {
      const panel = previewPanelRef.current;
      if (!panel) return;

      const top =
        panel.getBoundingClientRect().top +
        window.scrollY -
        PREVIEW_PANEL_SCROLL_OFFSET_PX;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: "smooth",
      });
    });
  };

  const pageStart = total === 0 ? 0 : ((currentPage - 1) * pageSize) + 1;
  const pageEnd = total === 0 ? 0 : pageStart + deferredThreads.length - 1;
  const activeFilterChips = buildActiveFilterChips(
    appliedFilters,
    session?.user.username ?? null
  );
  const hasActiveFilters = activeFilterChips.length > 0;

  const submitFilters = () => {
    setPageInput("1");
    setCurrentPage(1);
    setAppliedFilters(draftFilters);
  };

  const resetFilters = () => {
    setDraftFilters({
      title: "",
      author: "",
      team: "",
      tags: "",
      type: "ALL",
    });
    setPageInput("1");
    setCurrentPage(1);
    setAppliedFilters(INITIAL_FILTERS);
  };

  const goToPreviousPage = () => {
    if (currentPage <= 1 || loading) return;
    setPageAction("prev");
    setCurrentPage((page) => Math.max(1, page - 1));
  };

  const goToNextPage = () => {
    if (currentPage >= totalPages || loading) return;
    setPageAction("next");
    setCurrentPage((page) => Math.min(totalPages, page + 1));
  };

  const submitPageJump = () => {
    const parsedPage = Number(pageInput);

    if (!Number.isFinite(parsedPage)) {
      setPageInput(String(currentPage));
      return;
    }

    const targetPage = Math.min(totalPages, Math.max(1, Math.floor(parsedPage)));
    setPageInput(String(targetPage));

    if (targetPage === currentPage || loading) return;

    setPageAction("jump");
    setCurrentPage(targetPage);
  };

  const submitThread = async () => {
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
      const normalizedTags = normalizeThreadTags(composer.tags);

      const payload: {
        title: string;
        body: string;
        type: "GENERAL" | "TEAM";
        teamId?: number;
        tags?: string[];
      } = {
        title: trimmedTitle,
        body: trimmedBody,
        type: communityScopedCompose ? "TEAM" : composer.type,
      };

      if (payload.type === "TEAM") {
        const parsedTeamId =
          communityScopedCompose && scopedTeamId !== null ? scopedTeamId : Number(composer.teamId);
        if (!Number.isFinite(parsedTeamId)) {
          throw new Error("Choose a team for team threads.");
        }
        payload.teamId = parsedTeamId;
      }

      if (normalizedTags.length > 0) {
        payload.tags = normalizedTags;
      }

      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as ThreadRecord & { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Could not create thread.");
      }

      if (composer.includePoll) {
        const normalizedOptions = normalizePollOptions(composer.pollOptions);

        if (!composer.pollQuestion.trim()) {
          throw new Error("Add a poll question or turn the poll option off.");
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

      setComposer((current) => ({
        ...INITIAL_COMPOSER,
        type: communityScopedCompose ? "TEAM" : current.type,
        teamId:
          communityScopedCompose && scopedTeamId !== null
            ? String(scopedTeamId)
            : activeSession.user.favoriteTeamId && teams.some((team) => team.id === activeSession.user.favoriteTeamId)
            ? String(activeSession.user.favoriteTeamId)
            : communityScopedCompose && scopedTeamId !== null
              ? String(scopedTeamId)
              : "",
        pollDeadline: getDefaultPollDeadline(),
      }));

      if (communityScopedCompose && scopedTeamId !== null) {
        window.location.assign(
          buildThreadHref(result.id, {
            source: "community",
            communityTeamId: scopedTeamId,
          })
        );
        return;
      }

      setAppliedFilters(INITIAL_FILTERS);
      setDraftFilters(INITIAL_FILTERS);
      setCurrentPage(1);
      await loadThreads(INITIAL_FILTERS, 1);
      setSelectedThreadId(result.id);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not create thread.");
    } finally {
      setComposerPending(false);
    }
  };

  return (
    <section className="space-y-6">
      <div
        className="overflow-hidden rounded-[28px] border shadow-[0_30px_90px_rgba(2,8,23,0.14)]"
        style={{
          borderColor: "var(--surface-border)",
          background:
            "radial-gradient(circle at top left, rgba(56, 189, 248, 0.14), transparent 32%), radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.12), transparent 28%), var(--surface)",
        }}
      >
        <div className="grid gap-8 px-5 py-6 sm:px-7 sm:py-8 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              <Sparkles className="h-3.5 w-3.5" />
              Live Matchday Conversation
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight text-[color:var(--foreground)] sm:text-4xl">
                Scan the pulse of the forum and jump into the threads that matter.
              </h1>
              <p className="max-w-2xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
                Filter general discussion, team chatter, and match threads in one place. The page
                uses your backend filters directly, so title, author, team, and tag searches all
                map to the real API now.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Threads</p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--foreground)]">{total}</p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">Results matching your current filters</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Tags</p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--foreground)]">{summary.distinctTags}</p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">Distinct labels across matching results</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Mix</p>
              <p className="mt-2 text-lg font-bold text-[color:var(--foreground)]">
                {summary.byType.GENERAL}G / {summary.byType.TEAM}T / {summary.byType.MATCH}M
              </p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">General, team, and match balance across results</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 xl:hidden">
        <details className="overflow-hidden rounded-[22px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_36px_rgba(2,8,23,0.08)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
              <PencilLine className="h-4 w-4 text-sky-600" />
              Start a Thread
            </span>
            <ChevronDown className="h-4 w-4 text-[color:var(--muted-foreground)]" />
          </summary>
          <div ref={composerSectionRef} className="border-t border-[color:var(--surface-border)] p-4">
            <DiscussionsComposerPanel
              session={session}
              loginHref={loginHref}
              communityScopedCompose={communityScopedCompose}
              scopedTeamLabel={scopedTeamLabel}
              composer={composer}
              setComposer={setComposer}
              composerPending={composerPending}
              composerError={composerError}
              teams={teams}
              teamsLoading={teamsLoading}
              teamsError={teamsError}
              submitThread={submitThread}
            />
          </div>
        </details>

        <details className="overflow-hidden rounded-[22px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_36px_rgba(2,8,23,0.08)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
              <SlidersHorizontal className="h-4 w-4 text-sky-600" />
              Filters and Views
            </span>
            <ChevronDown className="h-4 w-4 text-[color:var(--muted-foreground)]" />
          </summary>
          <div className="space-y-5 border-t border-[color:var(--surface-border)] p-4">
            <DiscussionsFiltersPanel
              appliedFilters={appliedFilters}
              currentPage={currentPage}
              draftFilters={draftFilters}
              hasActiveFilters={hasActiveFilters}
              loadThreads={loadThreads}
              refreshing={refreshing}
              resetFilters={resetFilters}
              session={session}
              setDraftFilters={setDraftFilters}
              submitFilters={submitFilters}
            />
          </div>
        </details>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start">
        <aside className="hidden self-start space-y-5 rounded-[24px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_12px_40px_rgba(2,8,23,0.08)] backdrop-blur xl:sticky xl:top-24 xl:block">
          <div ref={composerSectionRef}>
            <DiscussionsComposerPanel
              session={session}
              loginHref={loginHref}
              communityScopedCompose={communityScopedCompose}
              scopedTeamLabel={scopedTeamLabel}
              composer={composer}
              setComposer={setComposer}
              composerPending={composerPending}
              composerError={composerError}
              teams={teams}
              teamsLoading={teamsLoading}
              teamsError={teamsError}
              submitThread={submitThread}
            />
          </div>

          <DiscussionsFiltersPanel
            appliedFilters={appliedFilters}
            currentPage={currentPage}
            draftFilters={draftFilters}
            hasActiveFilters={hasActiveFilters}
            loadThreads={loadThreads}
            refreshing={refreshing}
            resetFilters={resetFilters}
            session={session}
            setDraftFilters={setDraftFilters}
            submitFilters={submitFilters}
          />
        </aside>

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:items-start">
          <div className="space-y-4">
            <div ref={previewPanelRef} className="2xl:hidden">
              <div className="rounded-[24px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_12px_36px_rgba(2,8,23,0.08)]">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                    Quick Preview
                  </span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    Tap Preview on a card to inspect it without leaving the page.
                  </span>
                </div>
                <DiscussionPreviewContent selectedThread={selectedThread} />
              </div>
            </div>

            {hasActiveFilters && (
              <div className="rounded-[24px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                    Active Filters
                  </span>
                  {activeFilterChips.map((chip) => (
                    <span
                      key={chip.key}
                      className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-medium text-[color:var(--foreground)]"
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <LoadingStateList
                count={4}
                containerClassName="grid gap-4"
                itemClassName="h-40 animate-pulse rounded-[24px] border border-[color:var(--surface-border)] bg-[color:var(--surface)]"
                itemKeyPrefix="discussions-thread-skeleton"
              />
            ) : error ? (
              <ErrorStateCard
                title={"Couldn't load discussions"}
                message={error}
                className="rounded-[24px]"
              />
            ) : deferredThreads.length === 0 ? (
              <EmptyStateCard
                title={buildEmptyStateTitle(appliedFilters)}
                description={buildEmptyStateDescription(appliedFilters)}
                className="rounded-[24px] p-8 shadow-none"
                dashed
              />
            ) : (
              deferredThreads.map((thread, index) => {
                const active = selectedThread?.id === thread.id;
                const closedMatchThread = isClosedMatchThread(thread);
                const lifecycleSummary = getThreadLifecycleSummary(thread);
                const systemAuthor = isSystemThreadAuthor(thread);

                return (
                  <article
                    key={thread.id}
                    className={`group overflow-hidden rounded-[26px] border transition ${
                      active && closedMatchThread
                        ? "border-amber-400/45 bg-amber-400/10 shadow-[0_18px_50px_rgba(251,191,36,0.12)]"
                        : active
                        ? "border-sky-500/45 bg-sky-500/8 shadow-[0_18px_50px_rgba(56,189,248,0.12)]"
                        : closedMatchThread
                          ? "border-[color:var(--surface-border)] bg-[color:var(--surface)] opacity-90"
                        : "border-[color:var(--surface-border)] bg-[color:var(--surface)]"
                    }`}
                  >
                    <div className="px-5 py-5 sm:px-6">
                      <button
                        type="button"
                        onClick={() => setSelectedThreadId(thread.id)}
                        className="block w-full text-left"
                      >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] ${
                            closedMatchThread
                              ? "bg-amber-400/15 text-amber-700"
                              : thread.type === "MATCH"
                              ? "bg-emerald-400/15 text-emerald-700"
                              : thread.type === "TEAM"
                                ? "bg-amber-400/15 text-amber-700"
                                : "bg-sky-500/10 text-sky-700"
                          }`}
                        >
                          {thread.type}
                        </span>
                        {closedMatchThread && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                            <Lock className="h-3 w-3" />
                            Closed
                          </span>
                        )}
                        <span className="text-xs text-[color:var(--muted-foreground)]">#{thread.id}</span>
                        <span className="text-xs text-[color:var(--muted-foreground)]">{getThreadFeedTimestamp(thread)}</span>
                      </div>

                      <div className="mt-3 flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <h2 className="text-xl font-bold text-[color:var(--foreground)]">{thread.title}</h2>
                          <p
                            className={`line-clamp-4 max-w-3xl whitespace-pre-line text-sm ${
                              closedMatchThread ? "text-[color:var(--muted-foreground)]" : "text-[color:var(--muted-foreground)]"
                            }`}
                          >
                            {thread.body}
                          </p>
                          {lifecycleSummary && (
                            <p className="text-xs font-medium text-[color:var(--muted-foreground)]">{lifecycleSummary}</p>
                          )}
                        </div>
                        <div className="hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-right sm:block">
                          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Replies</p>
                          <p className="text-lg font-bold text-[color:var(--foreground)]">{thread._count.posts}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[color:var(--muted-foreground)]">
                        <span className="inline-flex items-center gap-2">
                          <Users className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                          {thread.author.username}
                        </span>
                        {systemAuthor && (
                          <span className="inline-flex items-center rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                            {SYSTEM_USER_BADGE}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                          {thread._count.posts} posts
                        </span>
                        {thread.team && (
                          <span className="inline-flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                            {thread.team.name}
                          </span>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {thread.tags.length > 0 ? (
                          thread.tags.map(({ tag: threadTag }) => (
                            <span
                              key={threadTag.id}
                              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[color:var(--muted-foreground)]"
                            >
                              <Tag className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" />
                              {threadTag.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-[color:var(--muted-foreground)]">No tags on this thread yet</span>
                        )}
                      </div>
                      </button>

                      <div className="mt-4 flex flex-wrap gap-3 border-t border-[color:var(--surface-border)] pt-4">
                        <button
                          type="button"
                          onClick={() => previewThread(thread.id)}
                          className="btn-secondary"
                        >
                          Preview Thread
                        </button>
                        <Link href={buildThreadHref(thread.id, { source: "discussions" })} className="btn-primary">
                          Open Thread
                        </Link>
                      </div>
                    </div>

                    <div
                      className="h-1 w-full bg-[linear-gradient(90deg,_rgba(56,189,248,0.8),_rgba(250,204,21,0.55),_rgba(16,185,129,0.75))]"
                      style={{ opacity: active ? 1 : 0.18 + ((index % 3) * 0.12) }}
                    />
                  </article>
                );
              })
            )}

            {!loading && !error && total > 0 && (
              <div className="flex flex-col gap-3 rounded-[24px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[color:var(--muted-foreground)]">
                  Showing <span className="font-semibold text-[color:var(--foreground)]">{pageStart}</span>-
                  <span className="font-semibold text-[color:var(--foreground)]">{pageEnd}</span> of{" "}
                  <span className="font-semibold text-[color:var(--foreground)]">{total}</span> threads
                </p>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={goToPreviousPage}
                    disabled={currentPage <= 1 || loading}
                    className="btn-secondary min-w-[96px] justify-center disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading && pageAction === "prev" ? (
                      <span className="inline-flex items-center gap-2">
                        <RefreshCcw className="h-4 w-4 animate-spin" />
                        Loading
                      </span>
                    ) : (
                      "Previous"
                    )}
                  </button>
                  <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-2 text-sm font-semibold whitespace-nowrap text-[color:var(--foreground)]">
                    Page {currentPage} of {Math.max(totalPages, 1)}
                  </div>
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <input
                      type="number"
                      min={1}
                      max={Math.max(totalPages, 1)}
                      value={pageInput}
                      onChange={(event) => setPageInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          submitPageJump();
                        }
                      }}
                      className="w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-center text-sm font-semibold text-[color:var(--foreground)] outline-none transition focus:border-sky-500 sm:w-20"
                      aria-label="Page number"
                    />
                    <button
                      type="button"
                      onClick={submitPageJump}
                      disabled={loading || totalPages <= 1}
                      className="btn-secondary min-w-[80px] justify-center disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {loading && pageAction === "jump" ? (
                        <span className="inline-flex items-center gap-2">
                          <RefreshCcw className="h-4 w-4 animate-spin" />
                          Go
                        </span>
                      ) : (
                        "Go"
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={goToNextPage}
                    disabled={currentPage >= totalPages || loading}
                    className="btn-secondary min-w-[96px] justify-center disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading && pageAction === "next" ? (
                      <span className="inline-flex items-center gap-2">
                        <RefreshCcw className="h-4 w-4 animate-spin" />
                        Loading
                      </span>
                    ) : (
                      "Next"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="hidden self-start rounded-[26px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_48px_rgba(2,8,23,0.08)] 2xl:sticky 2xl:top-24 2xl:block">
            <DiscussionPreviewContent selectedThread={selectedThread} />
          </aside>
        </div>
      </div>
    </section>
  );
}
