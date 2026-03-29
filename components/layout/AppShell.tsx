"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AUTH_CHANGED_EVENT,
  clearAuthSession,
  consumePendingAccountRestoredNotice,
  consumePendingStatusNotice,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
} from "@/components/auth/session";
import {
  THEME_CHANGED_EVENT,
  getStoredThemePreference,
  initThemeFromStorage,
  setThemePreference,
} from "@/components/theme/theme";
import Sidebar from "@/components/layout/Sidebar";
import TopNav from "@/components/layout/TopNav";
import type { AuthState } from "@/components/layout/types";

type AppShellProps = {
  children: ReactNode;
};

type FavoriteTeamLookup = {
  name: string;
  crestUrl: string | null;
};

const SIGNED_OUT_AUTH: AuthState = {
  isAuthenticated: false,
  username: null,
  avatar: null,
  notificationsCount: 0,
  accountStatus: null,
  accountStatusReason: null,
  suspendedUntil: null,
  accountRestoredNoticePending: false,
  favoriteTeamId: null,
  favoriteTeamName: null,
  favoriteTeamCrestUrl: null,
};

const favoriteTeamCache = new Map<number, FavoriteTeamLookup>();
const DESKTOP_SIDEBAR_COLLAPSED_KEY = "sportsdeck.desktopSidebarCollapsed";

export default function AppShell({ children }: AppShellProps) {
  const [auth, setAuth] = useState<AuthState>({ ...SIGNED_OUT_AUTH });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");
  const [showAccountStatusNotice, setShowAccountStatusNotice] = useState(false);
  const [showAppealApprovedNotice, setShowAppealApprovedNotice] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedValue = window.localStorage.getItem(
      DESKTOP_SIDEBAR_COLLAPSED_KEY
    );
    if (storedValue === "1") {
      setDesktopSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      DESKTOP_SIDEBAR_COLLAPSED_KEY,
      desktopSidebarCollapsed ? "1" : "0"
    );
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;

    const syncAuth = async () => {
      const refreshed = await refreshAccessTokenIfNeeded();
      const session = refreshed ?? loadAuthSession();
      if (cancelled) return;

      if (!session) {
        setAuth({ ...SIGNED_OUT_AUTH });
        setShowAccountStatusNotice(false);
        setShowAppealApprovedNotice(false);
        return;
      }

      const baseAuth: AuthState = {
        isAuthenticated: true,
        username: session.user.username,
        avatar: session.user.avatar,
        notificationsCount: 0,
        accountStatus: session.user.status,
        accountStatusReason: session.user.statusReason ?? null,
        suspendedUntil: session.user.suspendedUntil ?? null,
        accountRestoredNoticePending: session.user.accountRestoredNoticePending ?? false,
        favoriteTeamId: session.user.favoriteTeamId ?? null,
        favoriteTeamName: null,
        favoriteTeamCrestUrl: null,
      };

      if (
        consumePendingStatusNotice() &&
        (session.user.status === "SUSPENDED" || session.user.status === "BANNED")
      ) {
        setShowAccountStatusNotice(true);
      }

      if (consumePendingAccountRestoredNotice()) {
        setShowAppealApprovedNotice(true);
      }

      const favoriteTeamId = session.user.favoriteTeamId;
      if (!favoriteTeamId) {
        setAuth(baseAuth);
        return;
      }

      const cached = favoriteTeamCache.get(favoriteTeamId);
      if (cached) {
        setAuth({
          ...baseAuth,
          favoriteTeamName: cached.name,
          favoriteTeamCrestUrl: cached.crestUrl,
        });
        return;
      }

      try {
        const teamResponse = await fetch(`/api/teams/${favoriteTeamId}`, { cache: "no-store" });
        if (!teamResponse.ok) {
          setAuth(baseAuth);
          return;
        }

        const teamPayload = (await teamResponse.json()) as { name?: string; crestUrl?: string | null };
        const lookup: FavoriteTeamLookup = {
          name: teamPayload.name || "My Team",
          crestUrl: teamPayload.crestUrl ?? null,
        };
        favoriteTeamCache.set(favoriteTeamId, lookup);

        if (cancelled) return;
        setAuth({
          ...baseAuth,
          favoriteTeamName: lookup.name,
          favoriteTeamCrestUrl: lookup.crestUrl,
        });
      } catch {
        if (!cancelled) {
          setAuth(baseAuth);
        }
      }
    };

    void syncAuth();

    const onAuthChange = () => {
      void syncAuth();
    };

    const onWindowFocus = () => {
      void syncAuth();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncAuth();
      }
    };

    const intervalId = window.setInterval(() => {
      void syncAuth();
    }, 60_000);

    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChange);
    window.addEventListener("storage", onAuthChange);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChange);
      window.removeEventListener("storage", onAuthChange);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    const session = loadAuthSession();

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: session?.refreshToken ? JSON.stringify({ refreshToken: session.refreshToken }) : undefined,
      });
    } catch {
      // Best-effort request. We still clear local auth to return the UI to signed-out state.
    } finally {
      clearAuthSession();
      setAuth({ ...SIGNED_OUT_AUTH });
      setShowAccountStatusNotice(false);
      setShowAppealApprovedNotice(false);
      setMobileMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    const syncTheme = () => {
      const { resolved } = initThemeFromStorage();
      setResolvedTheme(resolved);
    };

    syncTheme();
    window.addEventListener(THEME_CHANGED_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => {
      if (getStoredThemePreference() === "system") {
        setResolvedTheme(setThemePreference("system"));
      }
    };
    media.addEventListener("change", onSystemThemeChange);

    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
      media.removeEventListener("change", onSystemThemeChange);
    };
  }, []);

  const handleSidebarToggle = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setDesktopSidebarCollapsed((current) => !current);
      return;
    }

    setMobileMenuOpen((current) => !current);
  }, []);

  const shellClass = "min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]";
  const mainClass = `relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[color:var(--background)] p-5 transition-[margin] duration-200 ease-out sm:p-7 lg:p-10 ${
    desktopSidebarCollapsed ? "lg:ml-0" : "lg:ml-64"
  }`;
  const mainBackdropClass =
    resolvedTheme === "light"
      ? "pointer-events-none absolute inset-0 bg-[radial-gradient(980px_420px_at_14%_-6%,rgba(56,189,248,0.17),transparent_60%),radial-gradient(920px_440px_at_86%_-10%,rgba(99,102,241,0.14),transparent_64%)]"
      : "pointer-events-none absolute inset-0 bg-[radial-gradient(980px_420px_at_14%_-6%,rgba(16,185,129,0.13),transparent_60%),radial-gradient(920px_440px_at_86%_-10%,rgba(14,165,233,0.11),transparent_64%)]";
  const mainTextureClass =
    resolvedTheme === "light"
      ? "pointer-events-none absolute inset-0 opacity-[0.04] [background-image:radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.95)_1px,transparent_0)] [background-size:14px_14px]"
      : "pointer-events-none absolute inset-0 opacity-[0.032] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.9)_1px,transparent_0)] [background-size:14px_14px]";
  const accountIsRestricted =
    auth.accountStatus === "SUSPENDED" || auth.accountStatus === "BANNED";
  const accountStatusTitle =
    auth.accountStatus === "SUSPENDED" ? "Account Suspended" : "Account Restricted";
  const accountStatusMessage =
    auth.accountStatus === "SUSPENDED"
      ? "Your account is temporarily suspended. Some actions may be unavailable until the restriction is lifted."
      : "Your account has been banned. You can still review your account details and submit an appeal if needed.";

  return (
    <div className={shellClass}>
      <TopNav
        auth={auth}
        onSidebarToggle={handleSidebarToggle}
        sidebarCollapsed={desktopSidebarCollapsed}
        onLogout={handleLogout}
      />
      <div className="w-full">
        <Sidebar
          auth={auth}
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
          desktopCollapsed={desktopSidebarCollapsed}
        />
        <main className={mainClass}>
          <div aria-hidden className={mainBackdropClass} />
          <div aria-hidden className={mainTextureClass} />
          <div className="relative z-10">{children}</div>
        </main>
      </div>
      {showAccountStatusNotice && accountIsRestricted ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={accountStatusTitle}
            className="w-full max-w-lg rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 shadow-[0_18px_50px_rgba(2,8,23,0.35)]"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
                Account Status
              </p>
              <h2 className="text-2xl font-bold text-[color:var(--foreground)]">
                {accountStatusTitle}
              </h2>
              <p className="text-sm text-[color:var(--muted-foreground)]">
                {accountStatusMessage}
              </p>
            </div>

            {auth.accountStatusReason ? (
              <div className="mt-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                  Restriction reason
                </p>
                <p className="mt-1 text-sm text-[color:var(--foreground)]">
                  {auth.accountStatusReason}
                </p>
              </div>
            ) : null}

            {auth.accountStatus === "SUSPENDED" && auth.suspendedUntil ? (
              <div className="mt-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                Suspended until {new Date(auth.suspendedUntil).toLocaleString()}.
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Link
                href="/settings?tab=account"
                onClick={() => setShowAccountStatusNotice(false)}
                className="btn-primary justify-center"
              >
                Review account
              </Link>
              <button
                type="button"
                onClick={() => setShowAccountStatusNotice(false)}
                className="btn-secondary"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showAppealApprovedNotice ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Your Account Was Restored"
            className="w-full max-w-lg rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 shadow-[0_18px_50px_rgba(2,8,23,0.35)]"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
                Account Update
              </p>
              <h2 className="text-2xl font-bold text-[color:var(--foreground)]">
                Your Account Was Restored
              </h2>
              <p className="text-sm text-[color:var(--muted-foreground)]">
                Your restriction has been lifted and you can use SportsDeck normally again.
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Link
                href="/"
                onClick={() => setShowAppealApprovedNotice(false)}
                className="btn-primary justify-center"
              >
                Continue
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
