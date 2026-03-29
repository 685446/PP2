import { normalizeFeedItems, type ApiFeedResponse } from "@/components/home/feedMapper";
import type { HomeFeedItem } from "@/components/home/types";

export const NOTIFICATIONS_SEEN_EVENT = "sportsdeck-notifications-seen";

type FeedApiPayload = ApiFeedResponse & {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  error?: string;
};

export type NotificationsResult = {
  items: HomeFeedItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export async function fetchNotifications(
  accessToken: string,
  options?: {
    page?: number;
    limit?: number;
    since?: string;
  }
): Promise<NotificationsResult> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(50, Math.max(1, options?.limit ?? 10));
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (options?.since) {
    params.set("since", options.since);
  }

  const response = await fetch(`/api/feed?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as FeedApiPayload;
  if (!response.ok) {
    throw new Error(payload.error || "Could not load notifications.");
  }

  return {
    items: normalizeFeedItems(payload),
    total: payload.total ?? 0,
    page: payload.page ?? page,
    limit: payload.limit ?? limit,
    totalPages: payload.totalPages ?? 1,
  };
}

function getNotificationsSeenKey(userId: number): string {
  return `sportsdeck.notifications.lastSeen.${userId}`;
}

export function getLastNotificationsSeenAt(userId: number): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(getNotificationsSeenKey(userId));
}

export function markNotificationsSeen(userId: number, seenAt = new Date().toISOString()): string {
  if (typeof window === "undefined") return seenAt;

  const normalizedSeenAt = new Date(seenAt).toISOString();
  window.localStorage.setItem(getNotificationsSeenKey(userId), normalizedSeenAt);
  window.dispatchEvent(new Event(NOTIFICATIONS_SEEN_EVENT));
  return normalizedSeenAt;
}

export async function fetchUnreadNotificationsCount(
  accessToken: string,
  userId: number
): Promise<number> {
  const since = getLastNotificationsSeenAt(userId);
  const payload = await fetchNotifications(accessToken, {
    page: 1,
    limit: 1,
    since: since ?? undefined,
  });
  return payload.total;
}
