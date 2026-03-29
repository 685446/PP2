export type AuthUser = {
  id: number;
  email: string;
  username: string;
  avatar: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  statusReason?: string | null;
  suspendedUntil?: string | null;
  accountRestoredNoticePending?: boolean;
  favoriteTeamId: number | null;
  authProvider?: "LOCAL" | "GOOGLE";
};

export type LoginSuccessPayload = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
};

export type StoredAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
};

export const AUTH_CHANGED_EVENT = "sportsdeck-auth-changed";

const KEYS = {
  accessToken: "sportsdeck.auth.accessToken",
  refreshToken: "sportsdeck.auth.refreshToken",
  user: "sportsdeck.auth.user",
  expiresAt: "sportsdeck.auth.expiresAt",
  pendingStatusNotice: "sportsdeck.auth.pendingStatusNotice",
  pendingAccountRestoredNotice: "sportsdeck.auth.pendingAccountRestoredNotice",
};

const DEFAULT_REFRESH_LEEWAY_MS = 60_000;
let refreshInFlight: Promise<StoredAuthSession | null> | null = null;

function emitAuthChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

function clearStorageKeys(storage: Storage): void {
  Object.values(KEYS).forEach((key) => storage.removeItem(key));
}

function resolveStorageWithSession(): Storage | null {
  if (typeof window === "undefined") return null;

  const local = readSessionFromStorage(window.localStorage);
  if (local) return window.localStorage;

  const session = readSessionFromStorage(window.sessionStorage);
  if (session) return window.sessionStorage;

  return null;
}

function readSessionAndStorage(): { session: StoredAuthSession; storage: Storage } | null {
  if (typeof window === "undefined") return null;

  const localSession = readSessionFromStorage(window.localStorage);
  if (localSession) return { session: localSession, storage: window.localStorage };

  const tabSession = readSessionFromStorage(window.sessionStorage);
  if (tabSession) return { session: tabSession, storage: window.sessionStorage };

  return null;
}

function readSessionFromStorage(storage: Storage): StoredAuthSession | null {
  const accessToken = storage.getItem(KEYS.accessToken);
  const refreshToken = storage.getItem(KEYS.refreshToken);
  const rawUser = storage.getItem(KEYS.user);
  const rawExpiresAt = storage.getItem(KEYS.expiresAt);

  if (!accessToken || !refreshToken || !rawUser || !rawExpiresAt) {
    return null;
  }

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as AuthUser;
    if (!user || typeof user.username !== "string") {
      return null;
    }

    return { accessToken, refreshToken, user, expiresAt };
  } catch {
    return null;
  }
}

export function persistAuthSession(payload: LoginSuccessPayload, rememberMe = true): void {
  if (typeof window === "undefined") return;

  const primary = rememberMe ? window.localStorage : window.sessionStorage;
  const secondary = rememberMe ? window.sessionStorage : window.localStorage;
  const expiresAt = String(Date.now() + payload.expiresIn * 1000);

  clearStorageKeys(secondary);

  primary.setItem(KEYS.accessToken, payload.accessToken);
  primary.setItem(KEYS.refreshToken, payload.refreshToken);
  primary.setItem(KEYS.user, JSON.stringify(payload.user));
  primary.setItem(KEYS.expiresAt, expiresAt);

  if (payload.user.status !== "ACTIVE") {
    window.sessionStorage.setItem(KEYS.pendingStatusNotice, "1");
  } else {
    window.sessionStorage.removeItem(KEYS.pendingStatusNotice);
  }

  if (payload.user.accountRestoredNoticePending) {
    window.sessionStorage.setItem(KEYS.pendingAccountRestoredNotice, "1");
  } else {
    window.sessionStorage.removeItem(KEYS.pendingAccountRestoredNotice);
  }

  emitAuthChanged();
}

export function loadAuthSession(): StoredAuthSession | null {
  const payload = readSessionAndStorage();
  if (!payload) return null;
  if (Date.now() >= payload.session.expiresAt) return null;
  return payload.session;
}

export function peekAuthSession(): StoredAuthSession | null {
  const payload = readSessionAndStorage();
  return payload?.session ?? null;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;

  clearStorageKeys(window.localStorage);
  clearStorageKeys(window.sessionStorage);
  emitAuthChanged();
}

export function consumePendingStatusNotice(): boolean {
  if (typeof window === "undefined") return false;

  const hasPending = window.sessionStorage.getItem(KEYS.pendingStatusNotice) === "1";
  if (hasPending) {
    window.sessionStorage.removeItem(KEYS.pendingStatusNotice);
  }

  return hasPending;
}

export function consumePendingAccountRestoredNotice(): boolean {
  if (typeof window === "undefined") return false;

  const hasPending =
    window.sessionStorage.getItem(KEYS.pendingAccountRestoredNotice) === "1";
  if (hasPending) {
    window.sessionStorage.removeItem(KEYS.pendingAccountRestoredNotice);
  }

  return hasPending;
}

export function patchStoredAuthUser(
  updates: Partial<AuthUser>
): AuthUser | null {
  if (typeof window === "undefined") return null;

  const storage = resolveStorageWithSession();
  if (!storage) return null;

  const current = readSessionFromStorage(storage);
  if (!current) return null;

  const nextUser: AuthUser = {
    ...current.user,
    ...updates,
  };

  storage.setItem(KEYS.user, JSON.stringify(nextUser));
  emitAuthChanged();
  return nextUser;
}

type RefreshOptions = {
  force?: boolean;
  leewayMs?: number;
};

export async function refreshAccessTokenIfNeeded(
  options: RefreshOptions = {}
): Promise<StoredAuthSession | null> {
  if (typeof window === "undefined") return null;

  const { force = false, leewayMs = DEFAULT_REFRESH_LEEWAY_MS } = options;
  const payload = readSessionAndStorage();
  if (!payload) return null;

  const { session, storage } = payload;
  const now = Date.now();
  const shouldRefresh = force || now >= session.expiresAt - leewayMs;

  if (!shouldRefresh) return session;
  if (!session.refreshToken) {
    clearStorageKeys(storage);
    emitAuthChanged();
    return null;
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        accessToken?: string;
        expiresIn?: number;
      };

      if (!response.ok || !data.accessToken || !data.expiresIn) {
        clearStorageKeys(storage);
        emitAuthChanged();
        return null;
      }

      const nextExpiresAt = Date.now() + data.expiresIn * 1000;
      storage.setItem(KEYS.accessToken, data.accessToken);
      storage.setItem(KEYS.expiresAt, String(nextExpiresAt));

      const refreshed: StoredAuthSession = {
        accessToken: data.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: nextExpiresAt,
        user: session.user,
      };

      emitAuthChanged();
      return refreshed;
    } catch {
      clearStorageKeys(storage);
      emitAuthChanged();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
