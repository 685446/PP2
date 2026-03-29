"use client";

import Link from "next/link";
import { Bell, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import NotificationListItem from "@/components/notifications/NotificationListItem";
import { EmptyStateCard, ErrorStateCard, LoadingStateList } from "@/components/shared/StateBlocks";
import type { HomeFeedItem } from "@/components/home/types";
import { fetchNotifications, markNotificationsSeen } from "@/lib/notifications";

type NotificationsState = {
  status: "idle" | "loading" | "ready" | "error";
  items: HomeFeedItem[];
  total: number;
  page: number;
  totalPages: number;
  errorMessage: string | null;
};

const PAGE_LIMIT = 12;

export default function NotificationsPage() {
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState<NotificationsState>({
    status: "idle",
    items: [],
    total: 0,
    page: 1,
    totalPages: 1,
    errorMessage: null,
  });

  const loadNotificationsPage = useCallback(
    async ({
      page,
      append,
      showLoading,
    }: {
      page: number;
      append: boolean;
      showLoading: boolean;
    }) => {
      if (showLoading) {
        setState((current) => ({
          ...current,
          status: "loading",
          errorMessage: null,
        }));
      } else if (append) {
        setLoadingMore(true);
      }

      try {
        const activeSession = (await refreshAccessTokenIfNeeded()) ?? loadAuthSession();
        setSession(activeSession);

        if (!activeSession?.accessToken) {
          setState({
            status: "idle",
            items: [],
            total: 0,
            page: 1,
            totalPages: 1,
            errorMessage: null,
          });
          return;
        }

        const payload = await fetchNotifications(activeSession.accessToken, {
          page,
          limit: PAGE_LIMIT,
        });

        if (!append && activeSession.user?.id) {
          markNotificationsSeen(activeSession.user.id);
        }

        setState((current) => ({
          status: "ready",
          items: append ? [...current.items, ...payload.items] : payload.items,
          total: payload.total,
          page: payload.page,
          totalPages: payload.totalPages,
          errorMessage: null,
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Could not load notifications.",
        }));
      } finally {
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    const syncSession = () => {
      const activeSession = loadAuthSession();
      setSession(activeSession);
      if (!activeSession?.accessToken) {
        setState({
          status: "idle",
          items: [],
          total: 0,
          page: 1,
          totalPages: 1,
          errorMessage: null,
        });
        return;
      }
      void loadNotificationsPage({ page: 1, append: false, showLoading: true });
    };

    syncSession();
    window.addEventListener(AUTH_CHANGED_EVENT, syncSession);
    window.addEventListener("storage", syncSession);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, [loadNotificationsPage]);

  const handleRefresh = () => {
    void loadNotificationsPage({ page: 1, append: false, showLoading: true });
  };

  const handleLoadMore = () => {
    if (loadingMore || state.page >= state.totalPages) return;
    void loadNotificationsPage({ page: state.page + 1, append: true, showLoading: false });
  };

  return (
    <section className="mx-auto w-full max-w-[1080px] space-y-5">
      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_10px_26px_rgba(2,8,23,0.08)] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-500">
              Notifications
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-[color:var(--foreground)] sm:text-3xl">
              Stay on top of every update
            </h1>
            <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
              Replies, followed-user activity, and favorite-team updates in one stream.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)]">
              <Bell className="h-3.5 w-3.5 text-sky-500" />
              {state.total} recent
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              className="btn-secondary w-full justify-center sm:w-auto"
              disabled={state.status === "loading"}
            >
              {state.status === "loading" ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {!session && (
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 shadow-[0_10px_26px_rgba(2,8,23,0.08)]">
          <p className="text-lg font-semibold text-[color:var(--foreground)]">Sign in to view notifications</p>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            Your personal updates appear here as soon as you log in.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href="/login?next=%2Fnotifications" className="btn-primary w-full justify-center sm:w-auto">
              Sign In
            </Link>
            <Link href="/register" className="btn-secondary w-full justify-center sm:w-auto">
              Create Account
            </Link>
          </div>
        </div>
      )}

      {session && state.status === "loading" && state.items.length === 0 && (
        <LoadingStateList
          count={4}
          containerClassName="grid gap-3"
          itemClassName="h-24 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]"
          itemKeyPrefix="notifications-skeleton"
        />
      )}

      {session && state.status === "error" && (
        <ErrorStateCard
          title="Could not load notifications"
          message={state.errorMessage || "Please try again."}
          onRetry={handleRefresh}
        />
      )}

      {session && state.status === "ready" && state.items.length === 0 && (
        <EmptyStateCard
          title="No notifications right now"
          description="New replies and team updates will appear here."
        />
      )}

      {session && state.items.length > 0 && (
        <div className="space-y-3">
          {state.items.map((item) => (
            <NotificationListItem key={item.id} item={item} />
          ))}
        </div>
      )}

      {session && state.status === "ready" && state.page < state.totalPages && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {loadingMore ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </section>
  );
}
