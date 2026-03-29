import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

function getPositiveIntFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const REPORT_COOLDOWN_MS = getPositiveIntFromEnv("REPORT_COOLDOWN_MS", 30 * SECOND_MS);
const REPORT_WINDOW_MS = getPositiveIntFromEnv("REPORT_WINDOW_MS", 10 * MINUTE_MS);
const REPORT_MAX_PER_WINDOW = getPositiveIntFromEnv("REPORT_MAX_PER_WINDOW", 5);

const recentReportAttempts = new Map<string, number>();

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

function pruneRecentAttempts(now: number) {
  for (const [key, timestamp] of recentReportAttempts.entries()) {
    if (now - timestamp > REPORT_COOLDOWN_MS) {
      recentReportAttempts.delete(key);
    }
  }
}

export async function enforceReportAbuseProtection(
  request: NextRequest,
  reporterId: number
) {
  const now = Date.now();
  pruneRecentAttempts(now);

  const clientAddress = getClientAddress(request);
  const cooldownKey = `${reporterId}:${clientAddress}`;
  const lastAttemptAt = recentReportAttempts.get(cooldownKey);

  if (lastAttemptAt && now - lastAttemptAt < REPORT_COOLDOWN_MS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((REPORT_COOLDOWN_MS - (now - lastAttemptAt)) / SECOND_MS)
    );
    return NextResponse.json(
      {
        error: `Please wait ${retryAfterSeconds} second(s) before sending another report`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  const windowStart = new Date(now - REPORT_WINDOW_MS);
  const reportsInWindow = await prisma.report.count({
    where: {
      reporterId,
      createdAt: {
        gte: windowStart,
      },
    },
  });

  if (reportsInWindow >= REPORT_MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil(REPORT_WINDOW_MS / SECOND_MS));
    return NextResponse.json(
      {
        error: `Report limit reached. You can send up to ${REPORT_MAX_PER_WINDOW} reports every ${Math.ceil(REPORT_WINDOW_MS / MINUTE_MS)} minute(s)`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  recentReportAttempts.set(cooldownKey, now);
  return null;
}
