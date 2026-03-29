import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const query = searchParams.get("q")?.trim() || "";
    const tags = (searchParams.get("tags") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 10);
    const skip = (page - 1) * limit;

    const conditions: Prisma.ThreadWhereInput[] = [
      { isHidden: false },
      { type: "GENERAL" },
    ];

    if (query) {
      conditions.push({
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { body: { contains: query, mode: "insensitive" } },
          { author: { is: { username: { contains: query, mode: "insensitive" } } } },
        ],
      });
    }

    if (tags.length > 0) {
      conditions.push(
        ...tags.map((tagName) => ({
          tags: {
            some: {
              tag: { name: tagName },
            },
          },
        }))
      );
    }

    const where: Prisma.ThreadWhereInput = {
      AND: conditions,
    };

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ openAt: "desc" }, { createdAt: "desc" }],
        include: {
          author: {
            select: { id: true, username: true, avatar: true },
          },
          team: {
            select: { id: true, name: true, crestUrl: true },
          },
          tags: {
            include: { tag: true },
          },
          _count: {
            select: { posts: true },
          },
        },
      }),
      prisma.thread.count({ where }),
    ]);

    return NextResponse.json({
      community: {
        id: 0,
        name: "Premier League General",
        shortName: "PL",
        crestUrl: null,
        venue: "League-wide",
      },
      threads,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        TEAM: total,
        MATCH: 0,
        GENERAL: total,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
