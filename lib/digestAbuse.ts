import { NextResponse, NextRequest } from "next/server";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

function getPositiveIntFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DIGEST_COOLDOWN_MS = getPositiveIntFromEnv("DIGEST_COOLDOWN_MS", 12 * SECOND_MS);
const DIGEST_WINDOW_MS = getPositiveIntFromEnv("DIGEST_WINDOW_MS", 10 * MINUTE_MS);
const DIGEST_MAX_PER_WINDOW = getPositiveIntFromEnv("DIGEST_MAX_PER_WINDOW", 30);

const recentDigestAttempts = new Map<string, number>();
const digestWindowAttempts = new Map<string, number[]>();

function getClientAddress(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

function buildRequesterKey(request: NextRequest, userId: number | null) {
  const clientAddress = getClientAddress(request);
  return userId ? `user:${userId}:${clientAddress}` : `anon:${clientAddress}`;
}

function pruneDigestAbuseMaps(now: number) {
  for (const [key, timestamp] of recentDigestAttempts.entries()) {
    if (now - timestamp > DIGEST_COOLDOWN_MS) {
      recentDigestAttempts.delete(key);
    }
  }

  for (const [key, attempts] of digestWindowAttempts.entries()) {
    const active = attempts.filter((timestamp) => now - timestamp <= DIGEST_WINDOW_MS);
    if (active.length === 0) {
      digestWindowAttempts.delete(key);
    } else {
      digestWindowAttempts.set(key, active);
    }
  }
}

export function enforceDigestAbuseProtection(
  request: NextRequest,
  userId: number | null
) {
  const now = Date.now();
  pruneDigestAbuseMaps(now);

  const requesterKey = buildRequesterKey(request, userId);
  const lastAttemptAt = recentDigestAttempts.get(requesterKey);

  if (lastAttemptAt && now - lastAttemptAt < DIGEST_COOLDOWN_MS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((DIGEST_COOLDOWN_MS - (now - lastAttemptAt)) / SECOND_MS)
    );

    return NextResponse.json(
      {
        error: `Please wait ${retryAfterSeconds} second(s) before requesting another daily digest.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  const attempts = digestWindowAttempts.get(requesterKey) || [];
  if (attempts.length >= DIGEST_MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil(DIGEST_WINDOW_MS / SECOND_MS));

    return NextResponse.json(
      {
        error: `Digest limit reached. You can request up to ${DIGEST_MAX_PER_WINDOW} digests every ${Math.ceil(DIGEST_WINDOW_MS / MINUTE_MS)} minute(s).`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  recentDigestAttempts.set(requesterKey, now);
  digestWindowAttempts.set(requesterKey, [...attempts, now]);

  return null;
}
