import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDays(rawDays: string | null): number | null {
  if (rawDays === null) return 30;

  const parsed = Number(rawDays);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return null;
  }
  return parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1];
      if (!verifyAccessToken(token)) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const days = parseDays(searchParams.get("days"));
    if (days === null) {
      return NextResponse.json(
        { error: "days must be an integer between 1 and 365" },
        { status: 400 }
      );
    }

    const now = new Date();
    const todayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const fromUtc = new Date(todayUtc.getTime() - (days - 1) * DAY_MS);
    const endExclusiveUtc = new Date(todayUtc.getTime() + DAY_MS);

    const [threads, posts] = await Promise.all([
      prisma.thread.findMany({
        where: {
          authorId: userId,
          isHidden: false,
          createdAt: { gte: fromUtc, lt: endExclusiveUtc },
        },
        select: { createdAt: true },
      }),
      prisma.post.findMany({
        where: {
          authorId: userId,
          isHidden: false,
          isDeleted: false,
          createdAt: { gte: fromUtc, lt: endExclusiveUtc },
        },
        select: { createdAt: true },
      }),
    ]);

    const bucketByDay = new Map<string, { threads: number; posts: number }>();
    for (let i = 0; i < days; i += 1) {
      const date = new Date(fromUtc.getTime() + i * DAY_MS);
      bucketByDay.set(toUtcDateKey(date), { threads: 0, posts: 0 });
    }

    for (const row of threads) {
      const key = toUtcDateKey(row.createdAt);
      const bucket = bucketByDay.get(key);
      if (bucket) bucket.threads += 1;
    }

    for (const row of posts) {
      const key = toUtcDateKey(row.createdAt);
      const bucket = bucketByDay.get(key);
      if (bucket) bucket.posts += 1;
    }

    const series = Array.from(bucketByDay.entries()).map(([date, counts]) => ({
      date,
      threads: counts.threads,
      posts: counts.posts,
      total: counts.threads + counts.posts,
    }));

    const totals = series.reduce(
      (acc, point) => ({
        threads: acc.threads + point.threads,
        posts: acc.posts + point.posts,
        total: acc.total + point.total,
      }),
      { threads: 0, posts: 0, total: 0 }
    );

    return NextResponse.json({
      userId,
      range: {
        days,
        from: toUtcDateKey(fromUtc),
        to: toUtcDateKey(todayUtc),
        tz: "UTC",
      },
      series,
      totals,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
