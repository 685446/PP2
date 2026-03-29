"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type UserResult = {
  id: number;
  username: string;
  avatar: string | null;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  favoriteTeam: {
    id: number;
    name: string;
    crestUrl: string | null;
  } | null;
  _count: {
    followers: number;
    following: number;
    threads: number;
    posts: number;
  };
};

type UsersPayload = {
  users?: UserResult[];
  total?: number;
  page?: number;
  totalPages?: number;
  error?: string;
};

type LoadState = "loading" | "ready" | "error";

function UserCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-[color:var(--surface-elevated)]" />
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-[color:var(--surface-elevated)]" />
          <div className="h-3 w-20 rounded bg-[color:var(--surface-elevated)]" />
        </div>
      </div>
      <div className="mt-4 h-3 w-40 rounded bg-[color:var(--surface-elevated)]" />
      <div className="mt-2 h-3 w-32 rounded bg-[color:var(--surface-elevated)]" />
    </div>
  );
}

function statusLabel(status: UserResult["status"]) {
  if (status === "ACTIVE") return "Active";
  if (status === "SUSPENDED") return "Suspended";
  return "Banned";
}

export default function PeopleDirectoryShell() {
  const [users, setUsers] = useState<UserResult[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadUsers = useCallback(async (search: string, nextPage: number) => {
    setErrorMessage(null);
    setLoadState((current) => (current === "ready" ? "ready" : "loading"));

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "18",
      });
      if (search) {
        params.set("q", search);
      }

      const response = await fetch(`/api/users?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as UsersPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load users.");
      }

      setUsers(Array.isArray(payload.users) ? payload.users : []);
      setTotal(Math.max(0, Number(payload.total) || 0));
      setPage(Math.max(1, Number(payload.page) || nextPage));
      setTotalPages(Math.max(1, Number(payload.totalPages) || 1));
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load users.");
    }
  }, []);

  useEffect(() => {
    void loadUsers(query, page);
  }, [loadUsers, page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setQuery(queryInput.trim());
    }, 200);

    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const emptyLabel = useMemo(() => {
    if (query) {
      return `No users match "${query}".`;
    }
    return "No users found.";
  }, [query]);

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_10px_26px_rgba(2,8,23,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_90%_at_10%_0%,rgba(14,165,233,0.14),transparent_56%),radial-gradient(120%_80%_at_100%_0%,rgba(56,189,248,0.14),transparent_62%)]" />
        <div className="relative space-y-4 p-4 sm:space-y-5 sm:p-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-accent)]">
              People
            </p>
            <h1 className="text-2xl font-bold text-[color:var(--foreground)] sm:text-4xl">
              Find Fans Across SportsDeck
            </h1>
            <p className="max-w-2xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
              Search by username or favorite team, then open a profile to see threads, posts, polls, and activity.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Results</p>
              <p className="mt-1 text-xl font-bold text-[color:var(--foreground)]">{total}</p>
            </div>
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Browse</p>
              <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">Search by username or club</p>
            </div>
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5 sm:col-span-2 lg:col-span-1">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Open</p>
              <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">Click a card for full profile</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
        <label className="relative block w-full sm:max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search username or favorite team..."
            className="h-11 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] pl-10 pr-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
          />
        </label>
      </div>

      {loadState === "loading" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <UserCardSkeleton key={`user-card-skeleton-${index}`} />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-4 text-sm text-[color:var(--foreground)]">
          {errorMessage || "Could not load users right now."}
        </div>
      )}

      {loadState === "ready" && (
        <>
          {users.length === 0 ? (
            <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-6 text-sm text-[color:var(--muted-foreground)]">
              {emptyLabel}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {users.map((user) => (
                <Link
                  key={user.id}
                  href={`/u/${encodeURIComponent(user.username)}`}
                  className="group rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_8px_22px_rgba(2,8,23,0.06)] transition hover:-translate-y-0.5 hover:border-sky-400/45 hover:shadow-[0_12px_28px_rgba(2,8,23,0.10)]"
                >
                  <div className="flex items-start gap-3">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={`${user.username} avatar`}
                        className="h-12 w-12 rounded-full object-cover sm:h-14 sm:w-14"
                      />
                    ) : (
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--surface-elevated)] text-lg font-bold text-[color:var(--foreground)] sm:h-14 sm:w-14">
                        {user.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <p className="break-words text-base font-bold text-[color:var(--foreground)]">
                          {user.username}
                        </p>
                        <span className="w-fit shrink-0 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--muted-foreground)]">
                          {statusLabel(user.status)}
                        </span>
                      </div>
                      {user.favoriteTeam ? (
                        <div className="mt-2 flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
                          {user.favoriteTeam.crestUrl ? (
                            <img
                              src={user.favoriteTeam.crestUrl}
                              alt=""
                              className="h-4 w-4 shrink-0 object-contain"
                            />
                          ) : null}
                          <span className="min-w-0 break-words">
                            Favorite team: {user.favoriteTeam.name}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                          No favorite team selected
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">Followers</p>
                      <p className="mt-1 font-semibold text-[color:var(--foreground)]">{user._count.followers}</p>
                    </div>
                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">Following</p>
                      <p className="mt-1 font-semibold text-[color:var(--foreground)]">{user._count.following}</p>
                    </div>
                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">Threads</p>
                      <p className="mt-1 font-semibold text-[color:var(--foreground)]">{user._count.threads}</p>
                    </div>
                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">Posts</p>
                      <p className="mt-1 font-semibold text-[color:var(--foreground)]">{user._count.posts}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[color:var(--muted-foreground)]">
              Page {page} of {totalPages}
            </p>
            <div className="flex w-full gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="btn-secondary flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="btn-secondary flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
