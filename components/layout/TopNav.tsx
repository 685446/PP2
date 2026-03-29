"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Bell,
  ChevronDown,
  LoaderCircle,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Settings,
  User,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAuthSession,
  refreshAccessTokenIfNeeded,
} from "@/components/auth/session";
import type { HomeFeedItem } from "@/components/home/types";
import {
  GUEST_NAV_ITEMS,
  TOP_NAV_NOTIFICATION_ITEM,
  USER_MENU_ACTIONS,
  USER_MENU_LINKS,
  getVisibleItems,
} from "@/components/layout/navConfig";
import NotificationListItem from "@/components/notifications/NotificationListItem";
import type { AuthState } from "@/components/layout/types";
import {
  fetchNotifications,
  fetchUnreadNotificationsCount,
  markNotificationsSeen,
  NOTIFICATIONS_SEEN_EVENT,
} from "@/lib/notifications";
import { isSystemIdentity } from "@/lib/systemUser";

type TopNavProps = {
  auth: AuthState;
  onSidebarToggle: () => void;
  sidebarCollapsed: boolean;
  onLogout?: () => void | Promise<void>;
};

type NotificationPreviewState = {
  status: "idle" | "loading" | "ready" | "error";
  items: HomeFeedItem[];
  total: number;
  errorMessage: string | null;
};

const NOTIFICATION_PREVIEW_LIMIT = 6;

function GuestIcon({ label }: { label: string }) {
  if (label === "Login") return <LogIn className="h-4 w-4" />;
  if (label === "Register") return <UserPlus className="h-4 w-4" />;
  return null;
}

export default function TopNav({
  auth,
  onSidebarToggle,
  sidebarCollapsed,
  onLogout,
}: TopNavProps) {
  const guestItems = getVisibleItems(GUEST_NAV_ITEMS, auth);
  const guestPrimaryItem =
    guestItems.find((item) => item.label === "Login") ?? guestItems[0] ?? null;
  const guestSecondaryItems = guestItems.filter(
    (item) => !guestPrimaryItem || item.href !== guestPrimaryItem.href
  );
  const canSeeNotifications = getVisibleItems([TOP_NAV_NOTIFICATION_ITEM], auth).length > 0;
  const systemIdentity = isSystemIdentity({
    username: auth.username,
    avatar: auth.avatar,
  });
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPreviewState>({
    status: "idle",
    items: [],
    total: 0,
    errorMessage: null,
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const notificationsMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationCount = unreadCount;
  const notificationBadge = notificationCount > 99 ? "99+" : String(notificationCount);

  const loadNotificationPreview = useCallback(
    async (mode: "silent" | "loading" = "loading") => {
      if (!auth.isAuthenticated) {
        setNotifications({
          status: "idle",
          items: [],
          total: 0,
          errorMessage: null,
        });
        return;
      }

      if (mode === "loading") {
        setNotifications((current) => ({
          ...current,
          status: "loading",
          errorMessage: null,
        }));
      }

      try {
        const activeSession = (await refreshAccessTokenIfNeeded()) ?? loadAuthSession();
        if (!activeSession?.accessToken) {
          throw new Error("Sign in to view notifications.");
        }

        const payload = await fetchNotifications(activeSession.accessToken, {
          page: 1,
          limit: NOTIFICATION_PREVIEW_LIMIT,
        });

        setNotifications({
          status: "ready",
          items: payload.items,
          total: payload.total,
          errorMessage: null,
        });
      } catch (error) {
        setNotifications((current) => ({
          ...current,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "Could not load notifications right now.",
        }));
      }
    },
    [auth.isAuthenticated]
  );

  const loadUnreadCount = useCallback(async () => {
    if (!auth.isAuthenticated) {
      setUnreadCount(0);
      return;
    }

    try {
      const activeSession = (await refreshAccessTokenIfNeeded()) ?? loadAuthSession();
      if (!activeSession?.accessToken || !activeSession.user?.id) {
        setUnreadCount(0);
        return;
      }

      const total = await fetchUnreadNotificationsCount(
        activeSession.accessToken,
        activeSession.user.id
      );
      setUnreadCount(total);
    } catch {
      setUnreadCount(0);
    }
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setIsNotificationsOpen(false);
      setNotifications({
        status: "idle",
        items: [],
        total: 0,
        errorMessage: null,
      });
      setUnreadCount(0);
      return;
    }

    void loadNotificationPreview("silent");
    void loadUnreadCount();
  }, [auth.isAuthenticated, loadNotificationPreview, loadUnreadCount]);

  useEffect(() => {
    if (!isNotificationsOpen) return;
    void loadNotificationPreview("loading");
  }, [isNotificationsOpen, loadNotificationPreview]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;

    const syncUnreadCount = () => {
      void loadUnreadCount();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadUnreadCount();
      }
    };

    window.addEventListener(NOTIFICATIONS_SEEN_EVENT, syncUnreadCount);
    window.addEventListener("focus", syncUnreadCount);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(NOTIFICATIONS_SEEN_EVENT, syncUnreadCount);
      window.removeEventListener("focus", syncUnreadCount);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [auth.isAuthenticated, loadUnreadCount]);

  useEffect(() => {
    if (!isUserMenuOpen && !isNotificationsOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (
        isUserMenuOpen &&
        userMenuRef.current &&
        !userMenuRef.current.contains(target)
      ) {
        setIsUserMenuOpen(false);
      }

      if (
        isNotificationsOpen &&
        notificationsMenuRef.current &&
        !notificationsMenuRef.current.contains(target)
      ) {
        setIsNotificationsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
        setIsNotificationsOpen(false);
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
  }, [isNotificationsOpen, isUserMenuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--nav-border)] bg-[color:var(--nav-bg)] text-[color:var(--nav-text)] shadow-[0_4px_18px_rgba(2,8,23,0.08)] backdrop-blur">
      <div className="flex h-[3.75rem] w-full items-center justify-between gap-2 px-2.5 sm:h-16 sm:gap-2.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onSidebarToggle}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)]/95 text-[color:var(--foreground)] shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition hover:border-sky-400/45 hover:bg-[color:var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/35 [html[data-theme='dark']_&]:border-[color:var(--nav-border)] [html[data-theme='dark']_&]:bg-[color:var(--nav-surface)] [html[data-theme='dark']_&]:shadow-[0_8px_20px_rgba(0,0,0,0.24)] [html[data-theme='dark']_&]:hover:bg-[color:var(--nav-hover)] lg:h-10 lg:w-10 lg:rounded-xl lg:shadow-none"
            aria-label={sidebarCollapsed ? "Expand navigation menu" : "Collapse navigation menu"}
          >
            <Menu className="h-6 w-6 lg:hidden" strokeWidth={2.25} />
            {sidebarCollapsed ? (
              <PanelLeftOpen className="hidden h-5 w-5 lg:block" strokeWidth={2.25} />
            ) : (
              <PanelLeftClose className="hidden h-5 w-5 lg:block" strokeWidth={2.25} />
            )}
          </button>

          <Link href="/" className="inline-flex min-w-0 items-center gap-1.5 sm:gap-2.5">
            <span className="brand-logo-stack h-5 w-5 shrink-0 sm:h-6 sm:w-6">
              <Image
                src="/branding/logo_icon_white.svg"
                alt="SportsDeck logo"
                width={24}
                height={22}
                className="brand-logo-dark h-5 w-auto sm:h-6"
                priority
              />
              <Image
                src="/branding/logo_icon_black.svg"
                alt="SportsDeck logo"
                width={24}
                height={22}
                className="brand-logo-light h-5 w-auto sm:h-6"
                priority
              />
            </span>
            <span className="truncate text-[13px] font-extrabold uppercase leading-none tracking-[0.005em] sm:text-lg">
              <span className="text-[color:var(--nav-text)]">Sports</span>
              <span className="text-sky-300">Deck</span>
            </span>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          {!auth.isAuthenticated && guestPrimaryItem && (
            <Link
              href={guestPrimaryItem.href}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[color:var(--btn-primary-bg)] px-3 text-sm font-semibold text-[color:var(--btn-primary-text)] transition hover:bg-[color:var(--btn-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 sm:h-10 sm:px-4"
            >
              <GuestIcon label={guestPrimaryItem.label} />
              {guestPrimaryItem.label}
            </Link>
          )}

          {!auth.isAuthenticated &&
            guestSecondaryItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`btn-secondary hidden sm:inline-flex ${
                  item.label === "Register" ? "sm:px-4" : ""
                }`}
              >
                <GuestIcon label={item.label} />
                {item.label}
              </Link>
            ))}

          {auth.isAuthenticated && canSeeNotifications && (
            <div ref={notificationsMenuRef} className="relative">
              <button
                type="button"
                onClick={async () => {
                  const nextOpen = !isNotificationsOpen;
                  setIsNotificationsOpen(nextOpen);
                  setIsUserMenuOpen(false);

                  if (!nextOpen) return;

                  const activeSession = (await refreshAccessTokenIfNeeded()) ?? loadAuthSession();
                  if (!activeSession?.user?.id) return;

                  markNotificationsSeen(activeSession.user.id);
                  setUnreadCount(0);
                }}
                aria-expanded={isNotificationsOpen}
                aria-haspopup="menu"
                aria-label="Notifications"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--nav-surface)] text-[color:var(--nav-text)] transition hover:bg-[color:var(--nav-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 sm:h-10 sm:w-10 [html[data-theme='dark']_&]:bg-transparent [html[data-theme='dark']_&]:hover:bg-[color:var(--nav-surface)] [html[data-theme='dark']_&]:focus-visible:bg-[color:var(--nav-surface)]"
              >
                <Bell className="h-4 w-4" />
                {notificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--nav-badge-bg)] px-1.5 text-[11px] font-bold text-[color:var(--nav-badge-text)]">
                    {notificationBadge}
                  </span>
                )}
              </button>

              {isNotificationsOpen && (
                <div className="fixed left-2 right-2 top-[4.25rem] z-[70] flex max-h-[calc(100dvh-4.75rem)] flex-col overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[0_18px_40px_rgba(2,8,23,0.28)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:z-auto sm:mt-2 sm:w-[22rem] sm:max-h-[min(70vh,28rem)] sm:max-w-[calc(100vw-1.5rem)]">
                  <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-[color:var(--foreground)]">Notifications</p>
                      <p className="text-xs text-[color:var(--muted-foreground)]">
                        {notificationCount > 0 ? `${notificationCount} recent updates` : "You are all caught up"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadNotificationPreview("loading")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--surface-border)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-elevated)]"
                      aria-label="Refresh notifications"
                    >
                      {notifications.status === "loading" ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    {notifications.status === "loading" && (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div
                            key={`notification-skeleton-${index}`}
                            className="h-20 animate-pulse rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]"
                          />
                        ))}
                      </div>
                    )}

                    {notifications.status === "error" && (
                      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-[color:var(--foreground)]">
                        <p className="font-semibold">Could not load notifications</p>
                        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          {notifications.errorMessage || "Please try again."}
                        </p>
                      </div>
                    )}

                    {notifications.status !== "loading" &&
                      notifications.status !== "error" &&
                      notifications.items.length === 0 && (
                        <p className="rounded-xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--muted-foreground)]">
                          No notifications right now.
                        </p>
                      )}

                    {notifications.items.length > 0 && (
                    <div className="space-y-2">
                      {notifications.items.map((item) => (
                        <NotificationListItem
                            key={item.id}
                            item={item}
                            compact
                            onNavigate={() => setIsNotificationsOpen(false)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-[color:var(--surface-border)] p-2">
                    <Link
                      href={TOP_NAV_NOTIFICATION_ITEM.href}
                      onClick={() => setIsNotificationsOpen(false)}
                      className="inline-flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold text-sky-500 transition hover:bg-[color:var(--surface-elevated)]"
                    >
                      See all notifications
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {auth.isAuthenticated && (
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen((open) => !open);
                  setIsNotificationsOpen(false);
                }}
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                className="list-none cursor-pointer rounded-full bg-[color:var(--nav-surface)] pl-0.5 pr-1 text-sm font-semibold text-[color:var(--nav-text)] transition hover:bg-[color:var(--nav-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 sm:pl-1.5 sm:pr-3 [html[data-theme='dark']_&]:bg-transparent [html[data-theme='dark']_&]:hover:bg-[color:var(--nav-surface)] [html[data-theme='dark']_&]:focus-visible:bg-[color:var(--nav-surface)]"
              >
                <span className="inline-flex h-10 max-w-[10.5rem] items-center gap-1 sm:h-10 sm:max-w-[14rem] sm:gap-2.5">
                  {auth.avatar ? (
                    <span
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-[color:var(--nav-border)] sm:h-8 sm:w-8 ${
                        systemIdentity ? "bg-white p-1" : ""
                      }`}
                    >
                      <img
                        src={auth.avatar}
                        alt={`${auth.username ?? "User"} avatar`}
                        className={`h-full w-full rounded-full ${
                          systemIdentity ? "object-contain" : "object-cover"
                        }`}
                      />
                    </span>
                  ) : (
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--btn-secondary-bg)] text-[color:var(--nav-text)] ring-1 ring-[color:var(--nav-border)] sm:h-8 sm:w-8">
                      <User className="h-4 w-4" />
                    </span>
                  )}
                  <span className="hidden truncate sm:inline">{auth.username ?? "Account"}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 opacity-75 transition-transform sm:h-4 sm:w-4 ${isUserMenuOpen ? "rotate-180" : ""}`}
                  />
                </span>
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-[min(11rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-[color:var(--nav-border)] bg-[color:var(--nav-surface)] shadow-[0_10px_22px_rgba(2,8,23,0.14)] backdrop-blur">
                  {USER_MENU_LINKS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsUserMenuOpen(false)}
                      className="inline-flex w-full items-center gap-2 px-3 py-2 text-sm text-[color:var(--nav-text)] transition hover:bg-[color:var(--nav-hover)]"
                    >
                      {item.label === "Profile" ? <User className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
                      {item.label}
                    </Link>
                  ))}

                  <div className="border-t border-[color:var(--nav-border)]" />

                  {USER_MENU_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={async () => {
                        setIsUserMenuOpen(false);
                        if (action.type === "logout") {
                          await onLogout?.();
                        }
                      }}
                      className="inline-flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[color:var(--nav-text)] transition hover:bg-[color:var(--nav-hover)]"
                    >
                      <LogOut className="h-4 w-4" />
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
