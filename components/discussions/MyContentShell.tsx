"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import {
  FolderOpenDot,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";

type OwnThread = {
  id: number;
  title: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: string;
  team: {
    id: number;
    name: string;
    crestUrl: string | null;
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

type OwnPost = {
  id: number;
  content: string;
  createdAt: string;
  parentId: number | null;
  edits: Array<{
    id: number;
  }>;
  isReply: boolean;
  thread: {
    id: number;
    title: string;
    type: "GENERAL" | "TEAM" | "MATCH";
    teamId: number | null;
    matchId: number | null;
  };
};

type OwnPoll = {
  id: number;
  question: string;
  createdAt: string;
  deadline: string;
  totalVotes: number;
  optionCount: number;
  isOpen: boolean;
  thread: {
    id: number;
    title: string;
    type: "GENERAL" | "TEAM" | "MATCH";
  };
};

type SectionState<T> = {
  items: T[];
  total: number;
  page: number;
  pageInput: string;
  totalPages: number;
  sort: "newest" | "oldest";
  loading: boolean;
  error: string | null;
};

type ThreadsResponse = {
  threads: OwnThread[];
  total: number;
  page: number;
  totalPages: number;
};

type PostsResponse = {
  posts: OwnPost[];
  total: number;
  page: number;
  totalPages: number;
};

type PollsResponse = {
  polls: OwnPoll[];
  total: number;
  page: number;
  totalPages: number;
};

const INITIAL_THREADS_STATE: SectionState<OwnThread> = {
  items: [],
  total: 0,
  page: 1,
  pageInput: "1",
  totalPages: 1,
  sort: "newest",
  loading: false,
  error: null,
};

const INITIAL_POSTS_STATE: SectionState<OwnPost> = {
  items: [],
  total: 0,
  page: 1,
  pageInput: "1",
  totalPages: 1,
  sort: "newest",
  loading: false,
  error: null,
};

const INITIAL_POLLS_STATE: SectionState<OwnPoll> = {
  items: [],
  total: 0,
  page: 1,
  pageInput: "1",
  totalPages: 1,
  sort: "newest",
  loading: false,
  error: null,
};

const PAGE_SIZE = 10;

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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildAuthHeaders(session: StoredAuthSession | null) {
  if (!session) return undefined;

  return {
    Authorization: `Bearer ${session.accessToken}`,
  };
}

async function fetchOwnThreads(
  session: StoredAuthSession,
  page: number,
  sort: "newest" | "oldest"
) {
  const response = await fetch(
    `/api/users/${session.user.id}/threads?page=${page}&limit=${PAGE_SIZE}&sort=${sort}`,
    {
      cache: "no-store",
      headers: buildAuthHeaders(session),
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to load your threads");
  }

  return (await response.json()) as ThreadsResponse;
}

async function fetchOwnPosts(
  session: StoredAuthSession,
  page: number,
  sort: "newest" | "oldest"
) {
  const response = await fetch(
    `/api/users/${session.user.id}/posts?page=${page}&limit=${PAGE_SIZE}&includeReplies=true&sort=${sort}`,
    {
      cache: "no-store",
      headers: buildAuthHeaders(session),
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to load your posts and replies");
  }

  return (await response.json()) as PostsResponse;
}

async function fetchOwnPolls(
  session: StoredAuthSession,
  page: number,
  sort: "newest" | "oldest"
) {
  const response = await fetch(
    `/api/users/${session.user.id}/polls?page=${page}&limit=${PAGE_SIZE}&sort=${sort}`,
    {
      cache: "no-store",
      headers: buildAuthHeaders(session),
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to load your polls");
  }

  return (await response.json()) as PollsResponse;
}

type PagerProps = {
  page: number;
  pageInput: string;
  totalPages: number;
  sort: "newest" | "oldest";
  loading: boolean;
  onPageInputChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSortChange: (sort: "newest" | "oldest") => void;
};

function SectionPager({
  page,
  pageInput,
  totalPages,
  sort,
  loading,
  onPageInputChange,
  onPageChange,
  onSortChange,
}: PagerProps) {
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
        <span>Sort</span>
        <select
          value={sort}
          onChange={(event) =>
            onSortChange(event.target.value === "oldest" ? "oldest" : "newest")
          }
          className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] outline-none transition focus:border-sky-500"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </label>
      {totalPages > 1 ? (
        <>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--foreground)]">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={Math.max(totalPages, 1)}
              value={pageInput}
              onChange={(event) => onPageInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const parsedPage = Number(pageInput);
                  const targetPage = Number.isFinite(parsedPage)
                    ? Math.min(totalPages, Math.max(1, Math.floor(parsedPage)))
                    : page;
                  onPageChange(targetPage);
                }
              }}
              className="w-20 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-center text-sm font-semibold text-[color:var(--foreground)] outline-none transition focus:border-sky-500"
              aria-label="Page number"
            />
            <button
              type="button"
              onClick={() => {
                const parsedPage = Number(pageInput);
                const targetPage = Number.isFinite(parsedPage)
                  ? Math.min(totalPages, Math.max(1, Math.floor(parsedPage)))
                  : page;
                onPageChange(targetPage);
              }}
              disabled={loading}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Go
            </button>
          </div>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </>
      ) : (
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[color:var(--muted-foreground)]">
          One page of results
        </div>
      )}
    </div>
  );
}

export default function MyContentShell() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [threads, setThreads] = useState<SectionState<OwnThread>>(INITIAL_THREADS_STATE);
  const [posts, setPosts] = useState<SectionState<OwnPost>>(INITIAL_POSTS_STATE);
  const [polls, setPolls] = useState<SectionState<OwnPoll>>(INITIAL_POLLS_STATE);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const syncSession = async () => {
      const refreshed = await refreshAccessTokenIfNeeded();
      const activeSession = refreshed ?? loadAuthSession();
      if (cancelled) return;

      setSession(activeSession);
      setAuthReady(true);
    };

    void syncSession();

    const onAuthChange = () => {
      void syncSession();
    };

    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChange);
    window.addEventListener("focus", onAuthChange);

    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChange);
      window.removeEventListener("focus", onAuthChange);
    };
  }, []);

  const loadAllSections = useCallback(
    async (
      activeSession: StoredAuthSession,
      nextThreadsPage = threads.page,
      nextPostsPage = posts.page,
      nextPollsPage = polls.page,
      options?: { background?: boolean }
    ) => {
      if (options?.background) {
        setRefreshing(true);
      }

      setThreads((current) => ({ ...current, loading: true, error: null }));
      setPosts((current) => ({ ...current, loading: true, error: null }));
      setPolls((current) => ({ ...current, loading: true, error: null }));

      const [threadsResult, postsResult, pollsResult] = await Promise.allSettled([
        fetchOwnThreads(activeSession, nextThreadsPage, threads.sort),
        fetchOwnPosts(activeSession, nextPostsPage, posts.sort),
        fetchOwnPolls(activeSession, nextPollsPage, polls.sort),
      ]);

      if (threadsResult.status === "fulfilled") {
        setThreads({
          items: threadsResult.value.threads,
          total: threadsResult.value.total,
          page: threadsResult.value.page,
          pageInput: String(threadsResult.value.page),
          totalPages: Math.max(threadsResult.value.totalPages, 1),
          sort: threads.sort,
          loading: false,
          error: null,
        });
      } else {
        setThreads((current) => ({
          ...current,
          loading: false,
          error:
            threadsResult.reason instanceof Error
              ? threadsResult.reason.message
              : "Failed to load your threads",
        }));
      }

      if (postsResult.status === "fulfilled") {
        setPosts({
          items: postsResult.value.posts,
          total: postsResult.value.total,
          page: postsResult.value.page,
          pageInput: String(postsResult.value.page),
          totalPages: Math.max(postsResult.value.totalPages, 1),
          sort: posts.sort,
          loading: false,
          error: null,
        });
      } else {
        setPosts((current) => ({
          ...current,
          loading: false,
          error:
            postsResult.reason instanceof Error
              ? postsResult.reason.message
              : "Failed to load your posts and replies",
        }));
      }

      if (pollsResult.status === "fulfilled") {
        setPolls({
          items: pollsResult.value.polls,
          total: pollsResult.value.total,
          page: pollsResult.value.page,
          pageInput: String(pollsResult.value.page),
          totalPages: Math.max(pollsResult.value.totalPages, 1),
          sort: polls.sort,
          loading: false,
          error: null,
        });
      } else {
        setPolls((current) => ({
          ...current,
          loading: false,
          error:
            pollsResult.reason instanceof Error
              ? pollsResult.reason.message
              : "Failed to load your polls",
        }));
      }

      if (options?.background) {
        setRefreshing(false);
      }
    },
    [threads.page, threads.sort, posts.page, posts.sort, polls.page, polls.sort]
  );

  useEffect(() => {
    if (!session) {
      setThreads(INITIAL_THREADS_STATE);
      setPosts(INITIAL_POSTS_STATE);
      setPolls(INITIAL_POLLS_STATE);
      setRefreshing(false);
      return;
    }

    void loadAllSections(session);
  }, [loadAllSections, session]);

  const loginHref = "/login?next=%2Fdiscussions%2Fmy-content";
  const totalAuthoredItems = threads.total + posts.total + polls.total;

  if (!authReady) {
    return (
      <section className="space-y-6">
        <div className="rounded-[28px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-10 text-center shadow-[0_20px_70px_rgba(2,8,23,0.08)]">
          <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-sky-600" />
          <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">
            Loading your content...
          </p>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="space-y-6">
        <div className="rounded-[28px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-8 shadow-[0_20px_70px_rgba(2,8,23,0.08)]">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
            <FolderOpenDot className="h-3.5 w-3.5" />
            My Content
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-[color:var(--foreground)]">
            Sign in to view your discussions, replies, and polls.
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
            This page brings all of your authored discussion content together in one place.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={loginHref} className="btn-primary">
              Sign In
            </Link>
            <Link href="/register" className="btn-secondary">
              Create Account
            </Link>
            <Link href="/discussions" className="btn-secondary">
              Back to Discussions
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_24px_80px_rgba(2,8,23,0.1)]">
        <div className="grid gap-6 px-5 py-6 sm:px-7 sm:py-8 xl:grid-cols-[1.3fr_0.9fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              <FolderOpenDot className="h-3.5 w-3.5" />
              My Content
            </div>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-[color:var(--foreground)] sm:text-4xl">
              Everything you have authored in one place.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
              Review your threads, posts and replies, and polls without leaving the
              Discussions area.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/discussions" className="btn-secondary">
                Back to Discussions
              </Link>
              <button
                type="button"
                onClick={() => void loadAllSections(session, threads.page, posts.page, polls.page, { background: true })}
                className="btn-secondary"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Total
              </p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--foreground)]">
                {totalAuthoredItems}
              </p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                Threads, posts, replies, and polls combined
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Threads
              </p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--foreground)]">
                {threads.total}
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Posts & Replies
              </p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--foreground)]">
                {posts.total}
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Polls
              </p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--foreground)]">
                {polls.total}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-[26px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_48px_rgba(2,8,23,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[color:var(--foreground)]">Threads</h2>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                Threads you started across general, team, and match discussions.
              </p>
            </div>
          </div>

          {threads.loading ? (
            <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-5 text-sm text-[color:var(--muted-foreground)]">
              Loading your threads...
            </div>
          ) : threads.error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-[color:var(--foreground)]">
              {threads.error}
            </div>
          ) : threads.items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-5 text-sm text-[color:var(--muted-foreground)]">
              You have not created any threads yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {threads.items.map((thread) => (
                <article
                  key={thread.id}
                  className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700">
                      {thread.type}
                    </span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {formatRelativeDate(thread.createdAt)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-[color:var(--foreground)]">
                    {thread.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[color:var(--muted-foreground)]">
                    <span>{thread._count.posts} posts</span>
                    {thread.team ? <span>{thread.team.name}</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {thread.tags.length > 0 ? (
                      thread.tags.map(({ tag }) => (
                        <span
                          key={tag.id}
                          className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-2.5 py-1 text-xs text-[color:var(--muted-foreground)]"
                        >
                          {tag.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-[color:var(--muted-foreground)]">
                        No tags
                      </span>
                    )}
                  </div>
                  <div className="mt-4">
                    <Link href={`/threads/${thread.id}?source=discussions`} className="btn-primary">
                      Open Thread
                    </Link>
                  </div>
                </article>
              ))}
              <SectionPager
                page={threads.page}
                pageInput={threads.pageInput}
                totalPages={threads.totalPages}
                sort={threads.sort}
                loading={threads.loading}
                onPageInputChange={(value) =>
                  setThreads((current) => ({ ...current, pageInput: value }))
                }
                onPageChange={(page) =>
                  setThreads((current) => ({
                    ...current,
                    page,
                    pageInput: String(page),
                  }))
                }
                onSortChange={(sort) =>
                  setThreads((current) => ({
                    ...current,
                    sort,
                    page: 1,
                    pageInput: "1",
                  }))
                }
              />
            </div>
          )}
        </section>

        <section className="rounded-[26px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_48px_rgba(2,8,23,0.08)]">
          <h2 className="text-xl font-bold text-[color:var(--foreground)]">Posts & Replies</h2>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            Every post and reply you have written across the forum.
          </p>

          {posts.loading ? (
            <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-5 text-sm text-[color:var(--muted-foreground)]">
              Loading your posts and replies...
            </div>
          ) : posts.error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-[color:var(--foreground)]">
              {posts.error}
            </div>
          ) : posts.items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-5 text-sm text-[color:var(--muted-foreground)]">
              You have not posted in any threads yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {posts.items.map((post) => (
                <article
                  key={post.id}
                  className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                      {post.isReply ? "Reply" : "Post"}
                    </span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {formatRelativeDate(post.createdAt)}
                    </span>
                    {post.edits.length > 0 ? (
                      <span className="text-xs text-[color:var(--muted-foreground)]">
                        {post.edits.length} edit{post.edits.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-base font-bold text-[color:var(--foreground)]">
                    {post.thread.title}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[color:var(--muted-foreground)]">
                    {post.content}
                  </p>
                  <div className="mt-4">
                    <Link
                      href={`/threads/${post.thread.id}?source=discussions&view=single-comment&postId=${post.id}`}
                      className="btn-primary"
                    >
                      Open in Thread
                    </Link>
                  </div>
                </article>
              ))}
              <SectionPager
                page={posts.page}
                pageInput={posts.pageInput}
                totalPages={posts.totalPages}
                sort={posts.sort}
                loading={posts.loading}
                onPageInputChange={(value) =>
                  setPosts((current) => ({ ...current, pageInput: value }))
                }
                onPageChange={(page) =>
                  setPosts((current) => ({
                    ...current,
                    page,
                    pageInput: String(page),
                  }))
                }
                onSortChange={(sort) =>
                  setPosts((current) => ({
                    ...current,
                    sort,
                    page: 1,
                    pageInput: "1",
                  }))
                }
              />
            </div>
          )}
        </section>

        <section className="rounded-[26px] border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_48px_rgba(2,8,23,0.08)]">
          <h2 className="text-xl font-bold text-[color:var(--foreground)]">Polls</h2>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            Polls you created inside discussion threads.
          </p>

          {polls.loading ? (
            <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-5 text-sm text-[color:var(--muted-foreground)]">
              Loading your polls...
            </div>
          ) : polls.error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-[color:var(--foreground)]">
              {polls.error}
            </div>
          ) : polls.items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-5 text-sm text-[color:var(--muted-foreground)]">
              You have not created any polls yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {polls.items.map((poll) => (
                <article
                  key={poll.id}
                  className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">
                      {poll.isOpen ? "Open Poll" : "Closed Poll"}
                    </span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {formatRelativeDate(poll.createdAt)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-[color:var(--foreground)]">
                    {poll.question}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[color:var(--muted-foreground)]">
                    <span>{poll.thread.title}</span>
                    <span>{poll.optionCount} options</span>
                    <span>{poll.totalVotes} votes</span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                    {poll.isOpen ? "Closes" : "Closed"} {formatDateTime(poll.deadline)}
                  </p>
                  <div className="mt-4">
                    <Link href={`/threads/${poll.thread.id}?source=discussions`} className="btn-primary">
                      Open Thread
                    </Link>
                  </div>
                </article>
              ))}
              <SectionPager
                page={polls.page}
                pageInput={polls.pageInput}
                totalPages={polls.totalPages}
                sort={polls.sort}
                loading={polls.loading}
                onPageInputChange={(value) =>
                  setPolls((current) => ({ ...current, pageInput: value }))
                }
                onPageChange={(page) =>
                  setPolls((current) => ({
                    ...current,
                    page,
                    pageInput: String(page),
                  }))
                }
                onSortChange={(sort) =>
                  setPolls((current) => ({
                    ...current,
                    sort,
                    page: 1,
                    pageInput: "1",
                  }))
                }
              />
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
