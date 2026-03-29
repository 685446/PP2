import { prisma } from "@/prisma/db";

const HOUR_MS = 60 * 60 * 1000;

function getPositiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const SYNC_TTL_MS = {
  teams: getPositiveIntFromEnv("SYNC_TTL_TEAMS_MS", 24 * HOUR_MS),
  matches: getPositiveIntFromEnv("SYNC_TTL_MATCHES_MS", 1 * HOUR_MS),
  standings: getPositiveIntFromEnv("SYNC_TTL_STANDINGS_MS", 1 * HOUR_MS),
};

interface FreshnessInput {
  ttlMs: number;
  count: number;
  lastSyncedAt: Date | string | null;
  scope: string;
}

function buildFreshnessResult({ ttlMs, count, lastSyncedAt, scope }: FreshnessInput) {
  if (count === 0 || !lastSyncedAt) {
    return { ttlMs, scope, count, lastSyncedAt: null, ageMs: null, isStale: true, shouldSync: true, reason: "empty" };
  }

  const lastSyncedMs = new Date(lastSyncedAt).getTime();
  const ageMs = Math.max(0, Date.now() - lastSyncedMs);
  const isStale = ageMs >= ttlMs;

  return {
    ttlMs, scope, count,
    lastSyncedAt: new Date(lastSyncedMs).toISOString(),
    ageMs, isStale, shouldSync: isStale,
    reason: isStale ? "stale" : "fresh",
  };
}

interface FreshnessModelInput {
  modelName: string;
  ttlMs: number;
  where: Record<string, unknown>;
  scope: string;
}

type FreshnessModel = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
  findFirst: (args: {
    where: Record<string, unknown>;
    orderBy: { updatedAt: "desc" };
    select: { updatedAt: true };
  }) => Promise<{ updatedAt: Date } | null>;
};

async function getFreshnessForModel({ modelName, ttlMs, where, scope }: FreshnessModelInput) {
  const model = (prisma as unknown as Record<string, unknown>)[modelName] as FreshnessModel;
  const count = await model.count({ where });

  if (count === 0) {
    return buildFreshnessResult({ ttlMs, count, lastSyncedAt: null, scope });
  }

  const latestRow = await model.findFirst({
    where,
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  return buildFreshnessResult({ ttlMs, count, lastSyncedAt: latestRow?.updatedAt || null, scope });
}

export async function getTeamsFreshness() {
  return getFreshnessForModel({ modelName: "team", ttlMs: SYNC_TTL_MS.teams, where: {}, scope: "all" });
}

export async function getMatchesFreshness(query: { season?: string } = {}) {
  const scopeWhere = query?.season ? { season: query.season } : {};
  const scope = query?.season ? `season:${query.season}` : "all";
  return getFreshnessForModel({ modelName: "match", ttlMs: SYNC_TTL_MS.matches, where: scopeWhere, scope });
}

export async function getStandingsFreshness(query: { season?: string } = {}) {
  const scopeWhere = query?.season ? { season: query.season } : {};
  const scope = query?.season ? `season:${query.season}` : "all";
  return getFreshnessForModel({ modelName: "standing", ttlMs: SYNC_TTL_MS.standings, where: scopeWhere, scope });
}

const activeSyncByKey = new Map<string, Promise<unknown>>();

export async function runSyncWithLock(lockKey: string, syncFn: () => Promise<unknown>) {
  if (activeSyncByKey.has(lockKey)) return activeSyncByKey.get(lockKey);

  const syncPromise = Promise.resolve()
    .then(syncFn)
    .finally(() => { activeSyncByKey.delete(lockKey); });

  activeSyncByKey.set(lockKey, syncPromise);
  return syncPromise;
}
