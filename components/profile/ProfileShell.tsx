"use client";

import Link from "next/link";
import {
  BarChart3,
  Flag,
  LoaderCircle,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { loadAuthSession, refreshAccessTokenIfNeeded } from "@/components/auth/session";
import { isSystemUsername } from "@/lib/systemUser";

type LoadState = "checking" | "loading" | "ready" | "signed-out" | "error";
type ContentTab = "threads" | "posts";
type SocialModal = "followers" | "following" | null;

type ProfilePayload = {
  id: number;
  username: string;
  avatar: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  favoriteTeamId: number | null;
  createdAt: string;
  isFollowing?: boolean;
  favoriteTeam: {
    id: number;
    name: string;
    crestUrl: string | null;
    palette?: {
      primaryRgb: string;
      secondaryRgb: string;
      source: "manual" | "crest" | "hash";
    };
  } | null;
  _count: {
    followers: number;
    following: number;
    threads: number;
    posts: number;
  };
};

type ThreadRecord = {
  id: number;
  title: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: string;
  _count?: { posts?: number };
};

type PostRecord = {
  id: number;
  body: string;
  createdAt: string;
  isReply?: boolean;
  thread?: {
    id: number;
    title: string;
  };
};

type UserMini = {
  id: number;
  username: string;
  avatar: string | null;
  followedAt: string;
  isFollowing?: boolean;
};

type ActivityPoint = {
  date: string;
  threads: number;
  posts: number;
  total: number;
};

type ActivityPayload = {
  series: ActivityPoint[];
  totals: {
    threads: number;
    posts: number;
    total: number;
  };
};

type PaginatedCollection<T> = {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
};

type ProfileData = {
  profile: ProfilePayload;
  threads: ThreadRecord[];
  posts: PostRecord[];
  followers: UserMini[];
  following: UserMini[];
  activity: ActivityPayload;
};

const DEFAULT_SUSPENSION_DAYS = 7;
const MAX_SUSPENSION_DAYS = 365;
const PROFILE_CONTENT_PAGE_SIZE = 10;

function createPaginatedCollection<T>(items: T[] = []): PaginatedCollection<T> {
  return {
    items,
    total: items.length,
    page: 1,
    totalPages: 1,
    loading: false,
    error: null,
  };
}

function formatRelativeTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "recently";

  const diffMs = date.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60000);
  const absMins = Math.abs(diffMins);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMins < 60) return formatter.format(diffMins, "minute");
  const diffHours = Math.round(diffMins / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function dateLabel(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusTone(status: ProfilePayload["status"]) {
  if (status === "ACTIVE") return "text-sky-400";
  if (status === "SUSPENDED") return "text-amber-400";
  return "text-rose-400";
}

function favoriteTeamBannerStyle(team: ProfilePayload["favoriteTeam"]): CSSProperties {
  const primary = team?.palette?.primaryRgb ?? "56,189,248";
  const secondary = team?.palette?.secondaryRgb ?? "16,185,129";

  return {
    backgroundColor: "rgba(2, 6, 23, 0.92)",
    backgroundImage: `linear-gradient(118deg, rgba(${primary}, 0.18) 0%, rgba(${secondary}, 0.22) 42%, rgba(2,6,23,0.10) 82%), radial-gradient(70% 140% at 0% 50%, rgba(${primary}, 0.52), transparent 68%), radial-gradient(70% 140% at 100% 35%, rgba(${secondary}, 0.48), transparent 70%), repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 16px, rgba(255,255,255,0) 16px 34px)`,
    backgroundBlendMode: "screen, normal, normal, soft-light",
  };
}

function favoriteTeamLightOverlayStyle(team: ProfilePayload["favoriteTeam"]): CSSProperties {
  const primary = team?.palette?.primaryRgb ?? "56,189,248";
  const secondary = team?.palette?.secondaryRgb ?? "16,185,129";

  return {
    backgroundImage: `linear-gradient(118deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0.03) 100%), radial-gradient(85% 160% at 0% 42%, rgba(${primary}, 0.52), transparent 70%), radial-gradient(85% 160% at 100% 30%, rgba(${secondary}, 0.48), transparent 72%), linear-gradient(125deg, rgba(${primary}, 0.18) 0%, rgba(${secondary}, 0.16) 100%), repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 14px, rgba(255,255,255,0.02) 14px 30px)`,
    backgroundBlendMode: "screen, normal, normal, normal, soft-light",
  };
}

function StatChip({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  const content = (
    <>
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--surface)] text-sky-600 [html[data-theme='dark']_&]:text-sky-400">
        {icon}
      </span>
      <p className="text-sm font-bold text-[color:var(--foreground)]">
        {value} <span className="font-semibold text-[color:var(--muted-foreground)]">{label}</span>
      </p>
    </>
  );

  if (interactive && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-w-[128px] items-center gap-2.5 rounded-full bg-[color:var(--surface-elevated)] px-3 py-2 shadow-[0_6px_14px_rgba(2,8,23,0.05)] transition hover:bg-[color:var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="inline-flex min-w-[128px] items-center gap-2.5 rounded-full bg-[color:var(--surface-elevated)] px-3 py-2 shadow-[0_6px_14px_rgba(2,8,23,0.05)]">
      {content}
    </div>
  );
}

function UserRow({
  user,
  viewerUserId,
  followed,
  followBusy,
  onToggleFollow,
  canRemoveFollower = false,
  removeBusy = false,
  onRemoveFollower,
}: {
  user: UserMini;
  viewerUserId: number | null;
  followed: boolean;
  followBusy: boolean;
  onToggleFollow: (user: UserMini, followed: boolean) => void;
  canRemoveFollower?: boolean;
  removeBusy?: boolean;
  onRemoveFollower?: (user: UserMini) => void;
}) {
  const isSelf = viewerUserId !== null && user.id === viewerUserId;

  return (
    <Link
      href={`/u/${encodeURIComponent(user.username)}`}
      className="group flex items-center justify-between gap-3 rounded-md px-2.5 py-2 transition hover:bg-[color:var(--surface-elevated)]"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {user.avatar ? (
          <img src={user.avatar} alt={`${user.username} avatar`} className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--surface)] text-[11px] font-bold text-[color:var(--foreground)]">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
        )}
        <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">{user.username}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isSelf ? (
          <span className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-2 py-1 text-xs font-semibold text-[color:var(--muted-foreground)]">
            You
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleFollow(user, followed);
              }}
              disabled={followBusy}
              className={`inline-flex min-w-[92px] justify-center rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                followed
                  ? "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]"
                  : "border-sky-500/65 bg-sky-500 text-white hover:bg-sky-400"
              } disabled:cursor-not-allowed disabled:opacity-80`}
            >
              {followBusy
                ? "Saving..."
                : canRemoveFollower
                  ? followed
                    ? "Unfollow"
                    : "Follow back"
                  : followed
                    ? "Unfollow"
                    : "Follow"}
            </button>
            {canRemoveFollower && onRemoveFollower ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemoveFollower(user);
                }}
                disabled={removeBusy}
                className="inline-flex h-8 w-8 items-center justify-center text-[color:var(--foreground)] transition hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
                aria-label={`Remove ${user.username} as a follower`}
              >
                {removeBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <X className="h-4 w-4" />}
              </button>
            ) : null}
          </>
        )}
      </div>
    </Link>
  );
}

function ProfileSkeleton() {
  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-4">
      <div className="animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6">
        <div className="h-24 rounded-xl bg-[color:var(--surface-elevated)]" />
        <div className="mt-4 h-8 w-64 rounded bg-[color:var(--surface-elevated)]" />
        <div className="mt-2 h-4 w-80 rounded bg-[color:var(--surface-elevated)]" />
      </div>
      <div className="h-60 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]" />
      <div className="h-64 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]" />
    </section>
  );
}

function ProfileTabPagination({
  page,
  totalPages,
  loading,
  onPrevious,
  onNext,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={loading || page <= 1}
        className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Previous
      </button>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Page {page} of {totalPages}
      </p>
      <button
        type="button"
        onClick={onNext}
        disabled={loading || page >= totalPages}
        className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Next
      </button>
    </div>
  );
}

type ProfileShellProps = {
  targetUserId?: number;
};

export default function ProfileShell({ targetUserId }: ProfileShellProps) {
  const [state, setState] = useState<LoadState>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);
  const [activeTab, setActiveTab] = useState<ContentTab>("threads");
  const [socialModal, setSocialModal] = useState<SocialModal>(null);
  const [viewerUserId, setViewerUserId] = useState<number | null>(null);
  const [viewerRole, setViewerRole] = useState<"USER" | "ADMIN" | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState("");
  const [reportPending, setReportPending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [moderationDraft, setModerationDraft] = useState("");
  const [moderationSuspendDays, setModerationSuspendDays] = useState(
    String(DEFAULT_SUSPENSION_DAYS)
  );
  const [moderationPendingAction, setModerationPendingAction] = useState<
    "suspend" | "ban" | "unban" | null
  >(null);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [moderationSuccess, setModerationSuccess] = useState<string | null>(null);
  const [modalFollowBusyId, setModalFollowBusyId] = useState<number | null>(null);
  const [modalFollowError, setModalFollowError] = useState<string | null>(null);
  const [modalFollowedIds, setModalFollowedIds] = useState<Record<number, boolean>>({});
  const [modalUsers, setModalUsers] = useState<UserMini[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalPage, setModalPage] = useState(1);
  const [modalTotalPages, setModalTotalPages] = useState(1);
  const [modalTotal, setModalTotal] = useState(0);
  const [modalQueryInput, setModalQueryInput] = useState("");
  const [modalQuery, setModalQuery] = useState("");
  const [tabContent, setTabContent] = useState<{
    threads: PaginatedCollection<ThreadRecord>;
    posts: PaginatedCollection<PostRecord>;
  }>({
    threads: createPaginatedCollection<ThreadRecord>(),
    posts: createPaginatedCollection<PostRecord>(),
  });

  const loadProfile = useCallback(async () => {
    setErrorMessage(null);
    setFollowError(null);
    setReportOpen(false);
    setReportDraft("");
    setReportPending(false);
    setReportError(null);
    setReportSuccess(null);
    setAlreadyReported(false);
    setModerationOpen(false);
    setModerationDraft("");
    setModerationSuspendDays(String(DEFAULT_SUSPENSION_DAYS));
    setModerationPendingAction(null);
    setModerationError(null);
    setModerationSuccess(null);
    setState((current) => (current === "ready" ? "loading" : "checking"));

    try {
      const refreshed = await refreshAccessTokenIfNeeded();
      const session = refreshed ?? loadAuthSession();
      const requestedUserId =
        typeof targetUserId === "number" && Number.isInteger(targetUserId) && targetUserId > 0
          ? targetUserId
          : null;
      const resolvedViewerId = session?.user?.id ?? null;
      const resolvedViewerRole = session?.user?.role ?? null;

      setViewerUserId(resolvedViewerId);
      setViewerRole(resolvedViewerRole);

      const userId = requestedUserId ?? resolvedViewerId;

      if (!userId) {
        setState("signed-out");
        setData(null);
        return;
      }

      const headers = session
        ? {
            Authorization: `Bearer ${session.accessToken}`,
          }
        : undefined;
      const requestInit = headers
        ? { headers, cache: "no-store" as const }
        : { cache: "no-store" as const };

      const [profileRes, threadsRes, postsRes, activityRes, followersRes, followingRes] =
        await Promise.all([
          fetch(`/api/users/${userId}`, requestInit),
          fetch(
            `/api/users/${userId}/threads?page=1&limit=${PROFILE_CONTENT_PAGE_SIZE}`,
            requestInit
          ),
          fetch(
            `/api/users/${userId}/posts?page=1&limit=${PROFILE_CONTENT_PAGE_SIZE}`,
            requestInit
          ),
          fetch(`/api/users/${userId}/activity?days=30`, requestInit),
          fetch(`/api/users/${userId}/followers?limit=30`, requestInit),
          fetch(`/api/users/${userId}/following?limit=30`, requestInit),
        ]);

      const [profileJson, threadsJson, postsJson, activityJson, followersJson, followingJson] =
        await Promise.all([
          profileRes.json().catch(() => ({})),
          threadsRes.json().catch(() => ({})),
          postsRes.json().catch(() => ({})),
          activityRes.json().catch(() => ({})),
          followersRes.json().catch(() => ({})),
          followingRes.json().catch(() => ({})),
        ]);

      if (!profileRes.ok) {
        throw new Error((profileJson as { error?: string }).error || "Failed to load profile.");
      }

      const nextThreads = Array.isArray((threadsJson as { threads?: ThreadRecord[] }).threads)
        ? (((threadsJson as { threads?: ThreadRecord[] }).threads as ThreadRecord[]) ?? [])
        : [];
      const nextPosts = Array.isArray((postsJson as { posts?: PostRecord[] }).posts)
        ? (((postsJson as { posts?: PostRecord[] }).posts as PostRecord[]) ?? [])
        : [];

      setData({
        profile: profileJson as ProfilePayload,
        threads: Array.isArray((threadsJson as { threads?: ThreadRecord[] }).threads)
          ? (((threadsJson as { threads?: ThreadRecord[] }).threads as ThreadRecord[]) ?? [])
          : [],
        posts: Array.isArray((postsJson as { posts?: PostRecord[] }).posts)
          ? (((postsJson as { posts?: PostRecord[] }).posts as PostRecord[]) ?? [])
          : [],
        followers: Array.isArray((followersJson as { followers?: UserMini[] }).followers)
          ? (((followersJson as { followers?: UserMini[] }).followers as UserMini[]) ?? [])
          : [],
        following: Array.isArray((followingJson as { following?: UserMini[] }).following)
          ? (((followingJson as { following?: UserMini[] }).following as UserMini[]) ?? [])
          : [],
        activity: {
          series: Array.isArray((activityJson as { series?: ActivityPoint[] }).series)
            ? (((activityJson as { series?: ActivityPoint[] }).series as ActivityPoint[]) ?? [])
            : [],
          totals:
            (activityJson as { totals?: ActivityPayload["totals"] }).totals || {
              threads: 0,
              posts: 0,
              total: 0,
            },
        },
      });
      setTabContent({
        threads: {
          items: nextThreads,
          total: Math.max(0, Number((threadsJson as { total?: number }).total) || 0),
          page: Math.max(1, Number((threadsJson as { page?: number }).page) || 1),
          totalPages: Math.max(1, Number((threadsJson as { totalPages?: number }).totalPages) || 1),
          loading: false,
          error: null,
        },
        posts: {
          items: nextPosts,
          total: Math.max(0, Number((postsJson as { total?: number }).total) || 0),
          page: Math.max(1, Number((postsJson as { page?: number }).page) || 1),
          totalPages: Math.max(1, Number((postsJson as { totalPages?: number }).totalPages) || 1),
          loading: false,
          error: null,
        },
      });
      setState("ready");
    } catch (error) {
      setState("error");
      setData(null);
      setTabContent({
        threads: createPaginatedCollection<ThreadRecord>(),
        posts: createPaginatedCollection<PostRecord>(),
      });
      setErrorMessage(error instanceof Error ? error.message : "Failed to load profile page.");
    }
  }, [targetUserId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!socialModal) {
      setModalUsers([]);
      setModalPage(1);
      setModalTotalPages(1);
      setModalTotal(0);
      setModalQuery("");
      setModalQueryInput("");
      return;
    }

    setModalFollowError(null);
    setModalFollowBusyId(null);
    setModalPage(1);
    setModalTotalPages(1);
    setModalTotal(0);
    setModalQuery("");
    setModalQueryInput("");

    const initialUsers = socialModal === "followers" ? data?.followers ?? [] : data?.following ?? [];
    setModalUsers(initialUsers);

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSocialModal(null);
    };
    document.addEventListener("keydown", onEsc);

    return () => {
      document.removeEventListener("keydown", onEsc);
    };
  }, [data?.followers, data?.following, socialModal]);

  useEffect(() => {
    if (!socialModal) return;
    const timer = window.setTimeout(() => {
      setModalPage(1);
      setModalQuery(modalQueryInput.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [modalQueryInput, socialModal]);

  const loadModalUsers = useCallback(
    async (mode: Exclude<SocialModal, null>, page: number, query: string) => {
      if (!data) return;

      setModalLoading(true);
      setModalFollowError(null);

      try {
        const refreshed = await refreshAccessTokenIfNeeded();
        const session = refreshed ?? loadAuthSession();
        const headers = session
          ? {
              Authorization: `Bearer ${session.accessToken}`,
            }
          : undefined;
        const requestInit = headers ? { headers } : undefined;

        const search = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        if (query) {
          search.set("q", query);
        }

        const response = await fetch(
          `/api/users/${data.profile.id}/${mode}?${search.toString()}`,
          requestInit
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          followers?: UserMini[];
          following?: UserMini[];
          total?: number;
          page?: number;
          totalPages?: number;
        };

        if (!response.ok) {
          if (response.status === 401) {
            setViewerUserId(null);
          }
          setModalFollowError(payload.error || `Failed to load ${mode}.`);
          return;
        }

        const users = mode === "followers" ? payload.followers : payload.following;
        setModalUsers(Array.isArray(users) ? users : []);
        setModalTotal(Math.max(0, Number(payload.total) || 0));
        setModalPage(Math.max(1, Number(payload.page) || page));
        setModalTotalPages(Math.max(1, Number(payload.totalPages) || 1));
      } catch {
        setModalFollowError("Network error while loading list.");
      } finally {
        setModalLoading(false);
      }
    },
    [data]
  );

  useEffect(() => {
    if (!socialModal) return;
    void loadModalUsers(socialModal, modalPage, modalQuery);
  }, [loadModalUsers, modalPage, modalQuery, socialModal]);

  const loadTabContentPage = useCallback(
    async (tab: ContentTab, page: number) => {
      if (!data) return;

      setTabContent((current) => ({
        ...current,
        [tab]: {
          ...current[tab],
          loading: true,
          error: null,
        },
      }));

      try {
        const refreshed = await refreshAccessTokenIfNeeded();
        const session = refreshed ?? loadAuthSession();
        const headers = session
          ? {
              Authorization: `Bearer ${session.accessToken}`,
            }
          : undefined;
        const requestInit = headers
          ? { headers, cache: "no-store" as const }
          : { cache: "no-store" as const };

        const response = await fetch(
          `/api/users/${data.profile.id}/${tab}?page=${page}&limit=${PROFILE_CONTENT_PAGE_SIZE}`,
          requestInit
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          threads?: ThreadRecord[];
          posts?: PostRecord[];
          total?: number;
          page?: number;
          totalPages?: number;
        };

        if (!response.ok) {
          throw new Error(payload.error || `Failed to load ${tab}.`);
        }

        let items: ThreadRecord[] | PostRecord[] = [];

        if (tab === "threads") {
          items = Array.isArray(payload.threads) ? payload.threads : [];
        } else {
          items = Array.isArray(payload.posts) ? payload.posts : [];
        }

        setTabContent((current) => ({
          ...current,
          [tab]: {
            items,
            total: Math.max(0, Number(payload.total) || 0),
            page: Math.max(1, Number(payload.page) || page),
            totalPages: Math.max(1, Number(payload.totalPages) || 1),
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        setTabContent((current) => ({
          ...current,
          [tab]: {
            ...current[tab],
            loading: false,
            error: error instanceof Error ? error.message : `Failed to load ${tab}.`,
          },
        }));
      }
    },
    [data]
  );

  const handleFollowToggle = useCallback(async () => {
    if (!data) return;

    const targetId = data.profile.id;
    const currentlyFollowing = Boolean(data.profile.isFollowing);
    const method = currentlyFollowing ? "DELETE" : "POST";
    const nextFollowing = !currentlyFollowing;

    setFollowBusy(true);
    setFollowError(null);

    try {
      const refreshed = await refreshAccessTokenIfNeeded();
      const session = refreshed ?? loadAuthSession();

      if (!session) {
        setViewerUserId(null);
        setFollowError("Sign in to follow users.");
        return;
      }

      const viewerFollower: UserMini = {
        id: session.user.id,
        username: session.user.username,
        avatar: session.user.avatar ?? null,
        followedAt: new Date().toISOString(),
      };
      const syncViewerInFollowersModal = (shouldFollow: boolean) => {
        if (socialModal !== "followers") return;

        setModalUsers((current) => {
          const exists = current.some((user) => user.id === viewerFollower.id);
          if (shouldFollow) {
            if (exists) return current;
            return [viewerFollower, ...current];
          }
          return current.filter((user) => user.id !== viewerFollower.id);
        });
        setModalTotal((current) => {
          if (shouldFollow) return current + 1;
          return Math.max(0, current - 1);
        });
      };

      const response = await fetch(`/api/users/${targetId}/follow`, {
        method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        if (response.status === 401) {
          setViewerUserId(null);
          setFollowError("Sign in to follow users.");
          return;
        }
        if (response.status === 409) {
          setModalFollowedIds((current) => ({ ...current, [targetId]: true }));
          syncViewerInFollowersModal(true);
          setData((current) => {
            if (!current) return current;
            if (current.profile.isFollowing) return current;
            const followerExists = current.followers.some((follower) => follower.id === viewerFollower.id);
            return {
              ...current,
              followers: followerExists ? current.followers : [viewerFollower, ...current.followers],
              profile: {
                ...current.profile,
                isFollowing: true,
                _count: {
                  ...current.profile._count,
                  followers: followerExists
                    ? current.profile._count.followers
                    : current.profile._count.followers + 1,
                },
              },
            };
          });
          return;
        }
        if (response.status === 404 && method === "DELETE") {
          setModalFollowedIds((current) => ({ ...current, [targetId]: false }));
          syncViewerInFollowersModal(false);
          setData((current) => {
            if (!current) return current;
            const followerExists = current.followers.some((follower) => follower.id === viewerFollower.id);
            return {
              ...current,
              followers: current.followers.filter((follower) => follower.id !== viewerFollower.id),
              profile: {
                ...current.profile,
                isFollowing: false,
                _count: {
                  ...current.profile._count,
                  followers:
                    followerExists && current.profile._count.followers > 0
                      ? current.profile._count.followers - 1
                      : current.profile._count.followers,
                },
              },
            };
          });
          return;
        }

        setFollowError(payload.error || "Failed to update follow state.");
        return;
      }

      setModalFollowedIds((current) => ({ ...current, [targetId]: nextFollowing }));
      syncViewerInFollowersModal(nextFollowing);

      setData((current) => {
        if (!current) return current;
        const wasFollowing = Boolean(current.profile.isFollowing);
        const nowFollowing = !wasFollowing;
        const followerExists = current.followers.some((follower) => follower.id === viewerFollower.id);
        const nextFollowers = nowFollowing
          ? followerExists
            ? current.followers
            : [viewerFollower, ...current.followers]
          : current.followers.filter((follower) => follower.id !== viewerFollower.id);
        const nextFollowerCount = nowFollowing
          ? followerExists
            ? current.profile._count.followers
            : current.profile._count.followers + 1
          : followerExists && current.profile._count.followers > 0
            ? current.profile._count.followers - 1
            : current.profile._count.followers;

        return {
          ...current,
          followers: nextFollowers,
          profile: {
            ...current.profile,
            isFollowing: nowFollowing,
            _count: {
              ...current.profile._count,
              followers: Math.max(0, nextFollowerCount),
            },
          },
        };
      });
    } catch {
      setFollowError("Network error while updating follow status.");
    } finally {
      setFollowBusy(false);
    }
  }, [data, socialModal]);

  const handleModalFollow = useCallback(
    async (targetUser: UserMini, followed: boolean) => {
      const ownProfile = Boolean(data && viewerUserId !== null && viewerUserId === data.profile.id);
      if (viewerUserId !== null && targetUser.id === viewerUserId) return;

      setModalFollowError(null);
      setModalFollowBusyId(targetUser.id);
      const method = followed ? "DELETE" : "POST";
      const nextFollowed = !followed;

      try {
        const refreshed = await refreshAccessTokenIfNeeded();
        const session = refreshed ?? loadAuthSession();

        if (!session) {
          setViewerUserId(null);
          setModalFollowError("Sign in to follow users.");
          return;
        }

        const response = await fetch(`/api/users/${targetUser.id}/follow`, {
          method,
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          actionTaken?: string;
        };

        const treatAsSuccess =
          response.ok ||
          (response.status === 409 && method === "POST") ||
          (response.status === 404 && method === "DELETE");

        if (!treatAsSuccess) {
          if (response.status === 401) {
            setViewerUserId(null);
            setModalFollowError("Sign in to follow users.");
            return;
          }
          setModalFollowError(payload.error || "Failed to update follow state.");
          return;
        }

        setModalFollowedIds((current) => ({
          ...current,
          [targetUser.id]: nextFollowed,
        }));
        setModalUsers((current) =>
          current.map((user) =>
            user.id === targetUser.id ? { ...user, isFollowing: nextFollowed } : user
          )
        );

        if (ownProfile && socialModal === "following" && !nextFollowed) {
          setModalUsers((current) => current.filter((user) => user.id !== targetUser.id));
          setModalTotal((current) => Math.max(0, current - 1));
        }

        if (ownProfile && socialModal === "following") {
          setData((current) => {
            if (!current) return current;
            const delta = nextFollowed ? 1 : -1;
            return {
              ...current,
              profile: {
                ...current.profile,
                _count: {
                  ...current.profile._count,
                  following: Math.max(0, current.profile._count.following + delta),
                },
              },
            };
          });
        }
      } catch {
        setModalFollowError("Network error while updating follow state.");
      } finally {
        setModalFollowBusyId((current) => (current === targetUser.id ? null : current));
      }
    },
    [data, socialModal, viewerUserId]
  );

  const handleRemoveFollower = useCallback(
    async (targetUser: UserMini) => {
      if (!data) return;

      setModalFollowError(null);
      setModalFollowBusyId(targetUser.id);

      try {
        const refreshed = await refreshAccessTokenIfNeeded();
        const session = refreshed ?? loadAuthSession();

        if (!session) {
          setViewerUserId(null);
          setModalFollowError("Sign in to manage followers.");
          return;
        }

        const response = await fetch(
          `/api/users/${data.profile.id}/followers/${targetUser.id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
            },
          }
        );

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          actionTaken?: string;
        };

        const treatedAsSuccess = response.ok || response.status === 404;
        if (!treatedAsSuccess) {
          if (response.status === 401) {
            setViewerUserId(null);
            setModalFollowError("Sign in to manage followers.");
            return;
          }

          setModalFollowError(payload.error || "Failed to remove follower.");
          return;
        }

        setModalUsers((current) => current.filter((user) => user.id !== targetUser.id));
        setModalTotal((current) => Math.max(0, current - 1));

        setData((current) => {
          if (!current) return current;
          const followerExists = current.followers.some((follower) => follower.id === targetUser.id);
          return {
            ...current,
            followers: current.followers.filter((follower) => follower.id !== targetUser.id),
            profile: {
              ...current.profile,
              _count: {
                ...current.profile._count,
                followers:
                  followerExists && current.profile._count.followers > 0
                    ? current.profile._count.followers - 1
                    : current.profile._count.followers,
              },
            },
          };
        });
      } catch {
        setModalFollowError("Network error while removing follower.");
      } finally {
        setModalFollowBusyId((current) => (current === targetUser.id ? null : current));
      }
    },
    [data]
  );

  const handleUserReportSubmit = useCallback(async () => {
    if (!data) return;

    setReportError(null);
    setReportSuccess(null);
    setReportPending(true);

    try {
      const refreshed = await refreshAccessTokenIfNeeded();
      const session = refreshed ?? loadAuthSession();

      if (!session) {
        setViewerUserId(null);
        setReportError("Sign in to report users.");
        return;
      }

      const reason = reportDraft.trim();
      if (!reason) {
        setReportError("Report reason cannot be empty.");
        return;
      }

      const response = await fetch(`/api/users/${data.profile.id}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ reason }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        if (response.status === 409) {
          setAlreadyReported(true);
          setReportOpen(false);
          setReportError(payload.error || "You have already reported this user.");
          return;
        }

        if (response.status === 401) {
          setViewerUserId(null);
          setReportError("Sign in to report users.");
          return;
        }

        setReportError(payload.error || "Could not report this user.");
        return;
      }

      setAlreadyReported(true);
      setReportOpen(false);
      setReportDraft("");
      setReportSuccess("User reported. Moderators will review the account.");
    } catch {
      setReportError("Network error while sending report.");
    } finally {
      setReportPending(false);
    }
  }, [data, reportDraft]);

  const handleModerationAction = useCallback(
    async (action: "suspend" | "ban" | "unban") => {
      if (!data) return;

      setModerationError(null);
      setModerationSuccess(null);
      setModerationPendingAction(action);

      try {
        const refreshed = await refreshAccessTokenIfNeeded();
        const session = refreshed ?? loadAuthSession();

        if (!session || session.user.role !== "ADMIN") {
          setViewerUserId(session?.user?.id ?? null);
          setViewerRole(session?.user?.role ?? null);
          setModerationError("Admin access is required to moderate users.");
          return;
        }

        let response: Response;

        if (action === "unban") {
          response = await fetch(`/api/users/${data.profile.id}/unban`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
            },
          });
        } else {
          const reason = moderationDraft.trim();
          if (!reason) {
            setModerationError("Reason is required.");
            return;
          }

          const suspensionDays = Number.parseInt(moderationSuspendDays, 10);
          if (
            action === "suspend" &&
            (!Number.isInteger(suspensionDays) ||
              suspensionDays < 1 ||
              suspensionDays > MAX_SUSPENSION_DAYS)
          ) {
            setModerationError(
              `Suspension length must be between 1 and ${MAX_SUSPENSION_DAYS} days.`
            );
            return;
          }

          const body =
            action === "suspend"
              ? {
                  reason,
                  suspendedUntil: new Date(
                    Date.now() + suspensionDays * 24 * 60 * 60 * 1000
                  ).toISOString(),
                }
              : { reason };

          response = await fetch(`/api/users/${data.profile.id}/ban`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.accessToken}`,
            },
            body: JSON.stringify(body),
          });
        }

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          actionTaken?: string;
        };

        if (!response.ok) {
          if (response.status === 401) {
            setViewerUserId(null);
            setViewerRole(null);
            setModerationError("Admin access is required to moderate users.");
            return;
          }

          setModerationError(payload.error || "Could not update this account.");
          return;
        }

        await loadProfile();
        setModerationOpen(false);
        setModerationDraft("");
        setModerationSuspendDays(String(DEFAULT_SUSPENSION_DAYS));
        setModerationSuccess(
          payload.actionTaken ||
            (action === "unban"
              ? "Account restriction lifted."
              : action === "suspend"
                ? "Account suspended and moderation history saved."
                : "Account banned and moderation history saved.")
        );
      } catch {
        setModerationError("Network error while updating account status.");
      } finally {
        setModerationPendingAction(null);
      }
    },
    [data, loadProfile, moderationDraft, moderationSuspendDays]
  );

  const activitySeries = useMemo(() => {
    if (!data?.activity.series?.length) return [];
    return data.activity.series.slice(-14);
  }, [data?.activity.series]);

  const activityMax = useMemo(() => {
    if (activitySeries.length === 0) return 1;
    return Math.max(1, ...activitySeries.map((point) => point.total));
  }, [activitySeries]);

  if (state === "checking" || state === "loading") {
    return <ProfileSkeleton />;
  }

  if (state === "signed-out") {
    return (
      <section className="mx-auto w-full max-w-[900px]">
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-8 text-center shadow-[0_12px_28px_rgba(2,8,23,0.08)]">
          <h1 className="text-2xl font-bold text-[color:var(--foreground)]">Profile</h1>
          <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">
            Sign in to view your profile, social stats, and activity history.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Link href="/login" className="btn-primary">
              Login
            </Link>
            <Link href="/register" className="btn-secondary">
              Register
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (state === "error" || !data) {
    return (
      <section className="mx-auto w-full max-w-[900px]">
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-100">
          <p className="text-lg font-semibold">Could not load profile</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage || "Please try again."}</p>
          <button type="button" onClick={() => void loadProfile()} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      </section>
    );
  }

  const { profile } = data;
  const threadsState = tabContent.threads;
  const postsState = tabContent.posts;
  const threads = threadsState.items;
  const posts = postsState.items;
  const isOwnProfile = viewerUserId !== null && viewerUserId === profile.id;
  const isAdminViewer = viewerRole === "ADMIN";
  const isRestrictedProfile = profile.status !== "ACTIVE";
  const canFollow = !isOwnProfile && viewerUserId !== null && !isRestrictedProfile;
  const canReportProfile =
    !isAdminViewer && !isOwnProfile && !isSystemUsername(profile.username);
  const canSubmitProfileReport = canReportProfile && viewerUserId !== null;
  const canModerateProfile =
    isAdminViewer &&
    !isOwnProfile &&
    !isSystemUsername(profile.username) &&
    profile.role !== "ADMIN";
  const modalTitle = socialModal === "followers" ? "Followers" : "Following";
  const bannerStyle = favoriteTeamBannerStyle(profile.favoriteTeam);
  const bannerLightStyle = favoriteTeamLightOverlayStyle(profile.favoriteTeam);
  const profileHref = `/users/${profile.id}`;
  const reportLoginHref = `/login?next=${encodeURIComponent(profileHref)}`;
  const parsedModerationSuspendDays = Number.parseInt(moderationSuspendDays, 10);
  const moderationSuspendDaysValid =
    Number.isInteger(parsedModerationSuspendDays) &&
    parsedModerationSuspendDays >= 1 &&
    parsedModerationSuspendDays <= MAX_SUSPENSION_DAYS;
  const handleTabPageChange = (tab: ContentTab, nextPage: number) => {
    void loadTabContentPage(tab, nextPage);
  };

  return (
    <section className="mx-auto w-full max-w-[1120px] space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_12px_26px_rgba(2,8,23,0.08)]">
        <div className="relative h-28 px-4 sm:h-36 sm:px-6" style={bannerStyle}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden [html[data-theme='light']_&]:block"
            style={bannerLightStyle}
          />
          {profile.favoriteTeam ? (
            <div className="absolute right-4 top-3 inline-flex items-center gap-3 rounded-xl border border-white/25 bg-black/30 px-3 py-2 backdrop-blur-sm shadow-[0_10px_24px_rgba(2,8,23,0.24)] sm:right-6 [html[data-theme='light']_&]:border-slate-200/80 [html[data-theme='light']_&]:bg-slate-50/72 [html[data-theme='light']_&]:shadow-[0_8px_20px_rgba(15,23,42,0.10)]">
              <div className="text-right leading-tight">
                <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-white/75 [html[data-theme='light']_&]:text-slate-500">Favorite Team</p>
                <p className="max-w-[170px] truncate text-sm font-semibold text-white [html[data-theme='light']_&]:text-slate-800">{profile.favoriteTeam.name}</p>
              </div>
              {profile.favoriteTeam.crestUrl ? (
                <img
                  src={profile.favoriteTeam.crestUrl}
                  alt={`${profile.favoriteTeam.name} crest`}
                  className="h-14 w-14 rounded-lg bg-white/15 p-1 object-contain [html[data-theme='light']_&]:bg-slate-100/90 [html[data-theme='light']_&]:ring-1 [html[data-theme='light']_&]:ring-slate-300/70"
                />
              ) : (
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-lg bg-white/15 text-xl font-black text-white [html[data-theme='light']_&]:bg-slate-100/90 [html[data-theme='light']_&]:text-slate-700 [html[data-theme='light']_&]:ring-1 [html[data-theme='light']_&]:ring-slate-300/70">
                  {profile.favoriteTeam.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div className="px-5 pb-5 sm:px-6">
          <div className="relative z-20 -mt-16 sm:-mt-20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="shrink-0">
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={`${profile.username} avatar`}
                    className="relative z-20 h-28 w-28 rounded-full border-2 border-[color:var(--surface)] object-cover shadow-[0_10px_26px_rgba(2,8,23,0.28)] ring-2 ring-[color:var(--surface)] sm:h-32 sm:w-32"
                  />
                ) : (
                  <span className="relative z-20 inline-flex h-28 w-28 items-center justify-center rounded-full border-2 border-[color:var(--surface)] bg-[color:var(--surface-elevated)] text-4xl font-black text-[color:var(--foreground)] shadow-[0_10px_26px_rgba(2,8,23,0.28)] ring-2 ring-[color:var(--surface)] sm:h-32 sm:w-32">
                    {profile.username.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              {isOwnProfile ? (
                <Link href="/settings?tab=profile" className="btn-secondary self-start sm:self-auto">
                  Edit Profile
                </Link>
              ) : canFollow ? (
                <div className="self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => void handleFollowToggle()}
                    disabled={followBusy}
                    className={`min-w-[132px] rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                      profile.isFollowing
                        ? "border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--foreground)] hover:bg-[color:var(--surface)]"
                        : "border-sky-500/70 bg-sky-500 text-white hover:bg-sky-400"
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {followBusy ? "Saving..." : profile.isFollowing ? "Following" : "Follow"}
                  </button>
                  {followError ? (
                    <p className="mt-1.5 text-xs text-rose-400">{followError}</p>
                  ) : null}
                </div>
              ) : !isOwnProfile && viewerUserId !== null && isRestrictedProfile ? (
                <span className="inline-flex items-center self-start rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--muted-foreground)] sm:self-auto">
                  Follow unavailable
                </span>
              ) : (
                <Link href="/login" className="btn-secondary self-start sm:self-auto">
                  Sign In to Follow
                </Link>
              )}
            </div>
          </div>

          <div className="mt-3">
            <h1 className="text-3xl font-bold tracking-tight text-[color:var(--foreground)] sm:text-4xl">{profile.username}</h1>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:mt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatChip
                label="followers"
                value={profile._count.followers}
                icon={<Users className="h-4 w-4" />}
                onClick={() => setSocialModal("followers")}
              />
              <StatChip
                label="following"
                value={profile._count.following}
                icon={<UserRound className="h-4 w-4" />}
                onClick={() => setSocialModal("following")}
              />
            </div>
            <div className="flex items-center gap-x-3 gap-y-1 text-sm text-[color:var(--muted-foreground)] sm:justify-end">
              <span>Joined {new Date(profile.createdAt).toLocaleDateString()}</span>
              <span className={statusTone(profile.status)}>{profile.status}</span>
            </div>
          </div>
        </div>
      </div>

      {isRestrictedProfile ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            profile.status === "SUSPENDED"
              ? "border-amber-400/40 bg-amber-400/10 text-amber-200 [html[data-theme='light']_&]:border-amber-500/35 [html[data-theme='light']_&]:bg-amber-500/10 [html[data-theme='light']_&]:text-amber-800"
              : "border-rose-400/40 bg-rose-400/10 text-rose-200 [html[data-theme='light']_&]:border-rose-500/35 [html[data-theme='light']_&]:bg-rose-500/10 [html[data-theme='light']_&]:text-rose-800"
          }`}
        >
          {profile.status === "SUSPENDED"
            ? "This account is temporarily suspended. Some actions may be limited."
            : "This account is banned. Content remains view-only."}
        </div>
      ) : null}

      {canModerateProfile ? (
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_10px_24px_rgba(2,8,23,0.06)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[color:var(--foreground)]">Moderate account</p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                Admin actions apply immediately and automatically create an approved moderation record for account history.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.status !== "BANNED" ? (
                <button
                  type="button"
                  onClick={() => {
                    setModerationError(null);
                    setModerationSuccess(null);
                    setModerationSuspendDays(String(DEFAULT_SUSPENSION_DAYS));
                    setModerationOpen((current) => !current);
                  }}
                  disabled={moderationPendingAction !== null}
                  className="inline-flex items-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-500/45 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {profile.status === "SUSPENDED" ? "Escalate or re-suspend" : "Ban or suspend"}
                </button>
              ) : null}
              {profile.status !== "ACTIVE" ? (
                <button
                  type="button"
                  onClick={() => void handleModerationAction("unban")}
                  disabled={moderationPendingAction !== null}
                  className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {moderationPendingAction === "unban" ? "Lifting..." : "Lift restriction"}
                </button>
              ) : null}
            </div>
          </div>

          {(moderationError || moderationSuccess) && (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                moderationError
                  ? "border-red-400/30 bg-red-500/10 text-[color:var(--foreground)]"
                  : "border-emerald-400/30 bg-emerald-500/10 text-[color:var(--foreground)]"
              }`}
            >
              {moderationError || moderationSuccess}
            </div>
          )}

          {moderationOpen && profile.status !== "BANNED" ? (
            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
              <label className="block text-sm font-medium text-[color:var(--foreground)]">
                Suspension length
              </label>
              <div className="mt-3 flex max-w-[220px] items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_SUSPENSION_DAYS}
                  step={1}
                  value={moderationSuspendDays}
                  onChange={(event) => {
                    setModerationError(null);
                    setModerationSuccess(null);
                    setModerationSuspendDays(event.target.value);
                  }}
                  disabled={moderationPendingAction !== null}
                  className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-rose-500/45 focus:ring-2 focus:ring-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="text-sm text-[color:var(--muted-foreground)]">days</span>
              </div>
              <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                Choose a temporary suspension from 1 to {MAX_SUSPENSION_DAYS} days.
              </p>

              <label className="mt-4 block text-sm font-medium text-[color:var(--foreground)]">
                Reason for moderation
              </label>
              <textarea
                value={moderationDraft}
                onChange={(event) => {
                  setModerationError(null);
                  setModerationSuccess(null);
                  setModerationDraft(event.target.value);
                }}
                disabled={moderationPendingAction !== null}
                placeholder="Explain why this account is being suspended or banned..."
                rows={4}
                maxLength={500}
                className="mt-3 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-rose-500/45 focus:ring-2 focus:ring-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[color:var(--muted-foreground)]">
                  {moderationDraft.trim().length}/500 characters
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModerationOpen(false);
                      setModerationSuspendDays(String(DEFAULT_SUSPENSION_DAYS));
                    }}
                    disabled={moderationPendingAction !== null}
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleModerationAction("suspend")}
                    disabled={
                      moderationPendingAction !== null ||
                      !moderationDraft.trim() ||
                      !moderationSuspendDaysValid
                    }
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {moderationPendingAction === "suspend"
                      ? "Suspending..."
                      : `Suspend ${parsedModerationSuspendDays || 0} day${
                          parsedModerationSuspendDays === 1 ? "" : "s"
                        }`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleModerationAction("ban")}
                    disabled={moderationPendingAction !== null || !moderationDraft.trim()}
                    className="inline-flex items-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-500/45 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {moderationPendingAction === "ban" ? "Banning..." : "Ban permanently"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : canReportProfile ? (
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_10px_24px_rgba(2,8,23,0.06)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[color:var(--foreground)]">Report account</p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                Use this for harassment, impersonation, spam, or account-level abuse.
              </p>
            </div>
            {canSubmitProfileReport ? (
              <button
                type="button"
                onClick={() => {
                  if (alreadyReported) {
                    setReportSuccess(null);
                    setReportError("You have already reported this user.");
                    return;
                  }
                  setReportError(null);
                  setReportSuccess(null);
                  setReportOpen((current) => !current);
                }}
                disabled={reportPending || alreadyReported}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:border-amber-500/45 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reportPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Flag className="h-4 w-4" />
                )}
                {reportPending
                  ? "Submitting..."
                  : alreadyReported
                    ? "Already reported"
                    : "Report user"}
              </button>
            ) : (
              <Link href={reportLoginHref} className="btn-secondary">
                Sign In to Report
              </Link>
            )}
          </div>

          {(reportError || reportSuccess) && (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                reportError
                  ? "border-red-400/30 bg-red-500/10 text-[color:var(--foreground)]"
                  : "border-emerald-400/30 bg-emerald-500/10 text-[color:var(--foreground)]"
              }`}
            >
              {reportError || reportSuccess}
            </div>
          )}

          {reportOpen && canSubmitProfileReport ? (
            <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/8 p-4">
              <label className="block text-sm font-medium text-[color:var(--foreground)]">
                Tell moderators why this account should be reviewed
              </label>
              <textarea
                value={reportDraft}
                onChange={(event) => {
                  setReportError(null);
                  setReportSuccess(null);
                  setReportDraft(event.target.value);
                }}
                disabled={reportPending}
                placeholder="Briefly explain what happened..."
                rows={4}
                maxLength={500}
                className="mt-3 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-amber-500/45 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[color:var(--muted-foreground)]">
                  {reportDraft.trim().length}/500 characters
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    disabled={reportPending}
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUserReportSubmit()}
                    disabled={reportPending || !reportDraft.trim()}
                    className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {reportPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Flag className="h-4 w-4" />
                    )}
                    {reportPending ? "Submitting..." : "Submit report"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
            <BarChart3 className="h-5 w-5" />
            Activity (Last 14 Days)
          </h2>
          <p className="text-xs text-[color:var(--muted-foreground)]">Threads + Posts</p>
        </div>

        {activitySeries.length === 0 ? (
          <p className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-4 text-sm text-[color:var(--muted-foreground)]">
            No activity yet. Once you post threads or comments, your chart appears here.
          </p>
        ) : (
          <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3">
            <div className="flex h-36 items-end gap-1.5">
              {activitySeries.map((point) => (
                <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-t-sm transition ${
                        point.total > 0
                          ? "bg-sky-500/70 hover:bg-sky-500/85"
                          : "bg-transparent"
                      }`}
                      style={{
                        height:
                          point.total > 0
                            ? `${Math.max(8, Math.round((point.total / activityMax) * 100))}%`
                            : "0%",
                      }}
                      title={`${point.total} on ${point.date}`}
                    />
                  </div>
                  <span className="text-[10px] text-[color:var(--muted-foreground)]">{dateLabel(point.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5">
        <div
          role="tablist"
          aria-label="Profile content tabs"
          className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "threads"}
            aria-controls="profile-threads-panel"
            id="profile-threads-tab"
            onClick={() => setActiveTab("threads")}
            className={`w-full border-r border-[color:var(--surface-border)] px-4 py-3 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45 ${
              activeTab === "threads"
                ? "border-b-2 border-b-sky-400 bg-[color:var(--surface)] text-[color:var(--foreground)]"
                : "border-b-2 border-b-transparent text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
            }`}
          >
            Threads ({threadsState.total})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "posts"}
            aria-controls="profile-posts-panel"
            id="profile-posts-tab"
            onClick={() => setActiveTab("posts")}
            className={`w-full px-4 py-3 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45 ${
              activeTab === "posts"
                ? "border-b-2 border-b-sky-400 bg-[color:var(--surface)] text-[color:var(--foreground)]"
                : "border-b-2 border-b-transparent text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
            }`}
          >
            Posts & Replies ({postsState.total})
          </button>
        </div>

        {activeTab === "threads" ? (
          <div
            role="tabpanel"
            id="profile-threads-panel"
            aria-labelledby="profile-threads-tab"
            className="space-y-2"
          >
            <div className="mb-2 flex justify-end">
              <Link href="/discussions" className="text-xs font-semibold text-sky-400 hover:text-sky-300">
                Open Discussions
              </Link>
            </div>

            {threadsState.loading ? (
              <p className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-4 text-sm text-[color:var(--muted-foreground)]">
                Loading threads...
              </p>
            ) : threadsState.error ? (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-4 text-sm text-[color:var(--foreground)]">
                <p>{threadsState.error}</p>
                <button
                  type="button"
                  onClick={() => handleTabPageChange("threads", threadsState.page)}
                  className="btn-secondary mt-3"
                >
                  Retry
                </button>
              </div>
            ) : threads.length === 0 ? (
              <p className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-4 text-sm text-[color:var(--muted-foreground)]">
                No threads yet.
              </p>
            ) : (
              <>
                {threads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/threads/${thread.id}`}
                    className="block rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5 transition hover:border-sky-400/55 hover:bg-[color:var(--surface)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">{thread.title}</p>
                      <p className="shrink-0 text-xs text-[color:var(--muted-foreground)]">{formatRelativeTime(thread.createdAt)}</p>
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      {thread.type} thread | {thread._count?.posts ?? 0} replies
                    </p>
                  </Link>
                ))}
                <ProfileTabPagination
                  page={threadsState.page}
                  totalPages={threadsState.totalPages}
                  loading={threadsState.loading}
                  onPrevious={() => handleTabPageChange("threads", threadsState.page - 1)}
                  onNext={() => handleTabPageChange("threads", threadsState.page + 1)}
                />
              </>
            )}
          </div>
        ) : (
          <div
            role="tabpanel"
            id="profile-posts-panel"
            aria-labelledby="profile-posts-tab"
            className="space-y-2"
          >
            {postsState.loading ? (
              <p className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-4 text-sm text-[color:var(--muted-foreground)]">
                Loading posts...
              </p>
            ) : postsState.error ? (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-4 text-sm text-[color:var(--foreground)]">
                <p>{postsState.error}</p>
                <button
                  type="button"
                  onClick={() => handleTabPageChange("posts", postsState.page)}
                  className="btn-secondary mt-3"
                >
                  Retry
                </button>
              </div>
            ) : posts.length === 0 ? (
              <p className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-4 text-sm text-[color:var(--muted-foreground)]">
                No posts yet.
              </p>
            ) : (
              <>
                {posts.map((post) => (
                  <Link
                    key={post.id}
                    href={post.thread?.id ? `/threads/${post.thread.id}` : "/discussions"}
                    className="block rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5 transition hover:border-sky-400/55 hover:bg-[color:var(--surface)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                        {post.isReply ? "Reply" : "Post"} | {post.thread?.title || "Discussion"}
                      </p>
                      <p className="shrink-0 text-xs text-[color:var(--muted-foreground)]">{formatRelativeTime(post.createdAt)}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-[color:var(--foreground)]">{post.body}</p>
                  </Link>
                ))}
                <ProfileTabPagination
                  page={postsState.page}
                  totalPages={postsState.totalPages}
                  loading={postsState.loading}
                  onPrevious={() => handleTabPageChange("posts", postsState.page - 1)}
                  onNext={() => handleTabPageChange("posts", postsState.page + 1)}
                />
              </>
            )}
          </div>
        )}
      </div>

      {socialModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
          onClick={() => setSocialModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={modalTitle}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_18px_38px_rgba(2,8,23,0.35)]"
          >
            <div className="mb-3 flex items-center justify-between border-b border-[color:var(--surface-border)] pb-2">
              <h3 className="text-lg font-bold text-[color:var(--foreground)]">{modalTitle}</h3>
              <button
                type="button"
                onClick={() => setSocialModal(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-foreground)] transition hover:bg-[color:var(--surface-elevated)] hover:text-[color:var(--foreground)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-3 space-y-2">
              <input
                type="search"
                value={modalQueryInput}
                onChange={(event) => setModalQueryInput(event.target.value)}
                placeholder={`Search ${modalTitle.toLowerCase()} by username`}
                className="w-full rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
              />
              <p className="text-xs text-[color:var(--muted-foreground)]">
                {modalTotal} result{modalTotal === 1 ? "" : "s"}
                {modalTotalPages > 1 ? ` â€¢ page ${modalPage} of ${modalTotalPages}` : ""}
              </p>
            </div>

            <div className="max-h-[50vh] divide-y divide-[color:var(--surface-border)] overflow-auto pr-1">
              {modalLoading ? (
                <p className="px-3 py-3 text-sm text-[color:var(--muted-foreground)]">Loading {modalTitle.toLowerCase()}...</p>
              ) : modalUsers.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
                  {modalQuery
                    ? `No ${modalTitle.toLowerCase()} match "${modalQuery}".`
                    : socialModal === "followers"
                      ? "No followers yet."
                      : "Not following anyone yet."}
                </p>
              ) : (
                modalUsers.map((user) => {
                  const followed =
                    modalFollowedIds[user.id] ??
                    user.isFollowing ??
                    (isOwnProfile && socialModal === "following");
                  const isBusy = modalFollowBusyId === user.id;
                  return (
                    <UserRow
                      key={`${socialModal}-${user.id}`}
                      user={user}
                      viewerUserId={viewerUserId}
                      followed={Boolean(followed)}
                      followBusy={isBusy}
                      onToggleFollow={handleModalFollow}
                      canRemoveFollower={isOwnProfile && socialModal === "followers"}
                      removeBusy={isBusy}
                      onRemoveFollower={handleRemoveFollower}
                    />
                  );
                })
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setModalPage((current) => Math.max(1, current - 1))}
                disabled={modalLoading || modalPage <= 1}
                className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setModalPage((current) => Math.min(modalTotalPages, current + 1))}
                disabled={modalLoading || modalPage >= modalTotalPages}
                className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
            {modalFollowError ? (
              <p className="mt-3 text-xs text-rose-400">{modalFollowError}</p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
