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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);

    if (!Number.isFinite(teamId)) {
      return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, shortName: true, crestUrl: true, venue: true },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const typeParam = (searchParams.get("type") || "ALL").toUpperCase();
    const query = searchParams.get("q")?.trim() || "";
    const tags = (searchParams.get("tags") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (!["ALL", "TEAM", "MATCH"].includes(typeParam)) {
      return NextResponse.json({ error: "Invalid type. Use ALL, TEAM, or MATCH" }, { status: 400 });
    }

    const now = new Date();
    const teamScope: Prisma.ThreadWhereInput = {
      type: "TEAM",
      teamId,
    };

    const matchScope: Prisma.ThreadWhereInput = {
      type: "MATCH",
      openAt: { lte: now },
      match: {
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
    };

    const scopedWhere: Prisma.ThreadWhereInput =
      typeParam === "TEAM"
        ? teamScope
        : typeParam === "MATCH"
          ? matchScope
          : {
              OR: [teamScope, matchScope],
            };

    const sharedConditions: Prisma.ThreadWhereInput[] = [{ isHidden: false }];

    if (query) {
      sharedConditions.push({
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { body: { contains: query, mode: "insensitive" } },
          { author: { is: { username: { contains: query, mode: "insensitive" } } } },
        ],
      });
    }

    if (tags.length > 0) {
      sharedConditions.push(
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
      AND: [...sharedConditions, scopedWhere],
    };
    const teamSummaryWhere: Prisma.ThreadWhereInput = {
      AND: [...sharedConditions, teamScope],
    };
    const matchSummaryWhere: Prisma.ThreadWhereInput = {
      AND: [...sharedConditions, matchScope],
    };
    const skip = (page - 1) * limit;

    const [threads, total, totalTeamThreads, totalMatchThreads] = await Promise.all([
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
          match: {
            select: {
              id: true,
              status: true,
              utcDate: true,
              matchWeek: true,
              season: true,
              homeScore: true,
              awayScore: true,
              homeTeam: {
                select: { id: true, name: true, shortName: true, crestUrl: true },
              },
              awayTeam: {
                select: { id: true, name: true, shortName: true, crestUrl: true },
              },
            },
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
      prisma.thread.count({ where: teamSummaryWhere }),
      prisma.thread.count({ where: matchSummaryWhere }),
    ]);

    const summary = {
      TEAM: totalTeamThreads,
      MATCH: totalMatchThreads,
    };

    return NextResponse.json({
      community: team,
      threads,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
