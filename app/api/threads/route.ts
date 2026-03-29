import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { verifyAccessToken } from "@/lib/auth";
import { buildThreadModerationText, syncAutoModerationReport } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";

type CreateThreadRequestBody = {
  title?: unknown;
  body?: unknown;
  type?: unknown;
  teamId?: unknown;
  tags?: unknown;
};

type CreateableThreadType = "GENERAL" | "TEAM";

function isCreateableThreadType(value: unknown): value is CreateableThreadType {
  return value === "GENERAL" || value === "TEAM";
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticate(request);
    if (error) return error;

    const { body: requestBody, error: bodyError } =
      await parseJsonBody<CreateThreadRequestBody>(request);
    if (bodyError) return bodyError;
    if (!requestBody) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { title, body, type, teamId, tags } = requestBody;

    if (!title || !body || !type) {
      return NextResponse.json(
        { error: "Title, body, and type are required" },
        { status: 400 }
      );
    }

    if (typeof title !== "string" || typeof body !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    if (!isCreateableThreadType(type)) {
      return NextResponse.json(
        { error: "Type must be GENERAL or TEAM" },
        { status: 400 }
      );
    }

    if (title.trim().length < 1 || title.trim().length > 200) {
      return NextResponse.json(
        { error: "Title must be between 1 and 200 characters" },
        { status: 400 }
      );
    }

    if (body.trim().length < 1 || body.trim().length > 10000) {
      return NextResponse.json(
        { error:"Body must be between 1 and 10000 characters" },
        { status: 400 }
      );
    }

    if (type === "TEAM") {
      if (typeof teamId !== "number") {
        return NextResponse.json(
          { error: "teamId is required for TEAM threads" },
          { status: 400 }
        );
      }
      const team = await prisma.team.findUnique({
      where: { id: teamId },
      });

      if (!team) {
        return NextResponse.json(
          { error: "Team not found" },
          { status: 404 }
        );
      }
    }

    // validation tags
    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return NextResponse.json(
          { error: "Tags must be an array" },
          { status: 400 }
        );
      }

      if (tags.length > 5) {
        return NextResponse.json(
          { error: "Maximum 5 tags allowed" },
          { status: 400 }
        );
      }

      if (
        !tags.every(
          (tag): tag is string =>
            typeof tag === "string" &&
            tag.trim().length > 0 &&
            tag.trim().length <= 30
        )
      ) {
        return NextResponse.json(
          { error: "Each tag must be between 1 and 30 characters" },
          { status: 400 }
        );
      }
    }

    const openAt = new Date();
    const normalizedTeamId = type === "TEAM" && typeof teamId === "number" ? teamId : null;

    const uniqueTags =
      tags && Array.isArray(tags)
        ? [...new Set(tags.map((tag) => tag.trim().toLowerCase()))]
        : [];
    
    const thread = await prisma.thread.create({
      data: {
        title: title.trim(),
        body: body.trim(),
        type,
        authorId: user.id,
        teamId: normalizedTeamId,
        openAt,
        closedAt: null,
        tags: uniqueTags.length
          ? {
              create: await Promise.all(
                uniqueTags.map(async (name) => {
                  const tag = await prisma.tag.upsert({
                    where: { name: name.trim() },
                    update: {},
                    create: { name: name.trim().toLowerCase() },
                  });
                  return { tagId: tag.id };
                })
              ),
            }
          : undefined,
      },
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
      },
    });

    await syncAutoModerationReport({
      targetType: "THREAD",
      threadId: thread.id,
      text: buildThreadModerationText({
        title: thread.title,
        body: thread.body,
      }),
      contentType: "thread",
      source: "thread create",
    });

    return NextResponse.json(thread, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1]?.trim();
      if (!token || !verifyAccessToken(token)) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const now = new Date();

    const type = searchParams.get("type");
    const teamId = searchParams.get("teamId");
    const authorId = searchParams.get("authorId");
    const team = searchParams.get("team")?.trim() || null;
    const author = searchParams.get("author")?.trim() || null;
    const title = searchParams.get("title")?.trim() || null;
    const search = searchParams.get("search")?.trim() || null;
    const hasPoll = searchParams.get("hasPoll");
    const tagsValues = [
      ...searchParams.getAll("tags").flatMap((value) => value.split(",")),
      ...searchParams.getAll("tag").flatMap((value) => value.split(",")),
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const tags = [...new Set(tagsValues)];
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    // validate type if provided
    const validTypes = ["GENERAL", "TEAM", "MATCH"];
    if (type && !validTypes.includes(type)) {
      return NextResponse.json(
        { error: "Invalid type" },
        { status: 400 }
      );
    }

    if (teamId && isNaN(Number(teamId))) {
      return NextResponse.json(
        { error: "Invalid teamId" },
        { status: 400 }
      );
    }

    if (authorId && isNaN(Number(authorId))) {
      return NextResponse.json(
        { error: "Invalid authorId" },
        { status: 400 }
      );
    }

    if (team && teamId) {
      return NextResponse.json(
        { error: "Use either team or teamId, not both" },
        { status: 400 }
      );
    }

    if (author && authorId) {
      return NextResponse.json(
        { error: "Use either author or authorId, not both" },
        { status: 400 }
      );
    }

    if (title && title.length > 200) {
      return NextResponse.json(
        { error: "Title must be 200 characters or fewer" },
        { status: 400 }
      );
    }

    if (author && author.length > 100) {
      return NextResponse.json(
        { error: "Author must be 100 characters or fewer" },
        { status: 400 }
      );
    }

    if (team && team.length > 100) {
      return NextResponse.json(
        { error: "Team must be 100 characters or fewer" },
        { status: 400 }
      );
    }

    if (tags.some((value) => value.length > 30)) {
      return NextResponse.json(
        { error: "Each tag must be 30 characters or fewer" },
        { status: 400 }
      );
    }

    const resolvedTitle = title || search;
    const requirePoll = hasPoll === "1" || hasPoll === "true";

    const sharedWhere: Prisma.ThreadWhereInput = {
      isHidden: false,
      ...(requirePoll && {
        poll: {
          isNot: null,
        },
      }),
      ...(teamId && { teamId: Number(teamId) }),
      ...(authorId && { authorId: Number(authorId) }),
      ...(team && {
        team: {
          is: {
            name: {
              contains: team,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        },
      }),
      ...(author && {
        author: {
          is: {
            username: {
              contains: author,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        },
      }),
      ...(resolvedTitle && {
        title: {
          contains: resolvedTitle,
          mode: Prisma.QueryMode.insensitive,
        },
      }),
      ...(tags.length && {
        AND: tags.map((tagName) => ({
          tags: {
            some: {
              tag: { name: tagName },
            },
          },
        })),
      }),
    };

    // Listing policy:
    // - GENERAL and TEAM threads are always visible (when not hidden)
    // - MATCH threads are visible only after openAt
    const generalWhere: Prisma.ThreadWhereInput = {
      ...sharedWhere,
      type: "GENERAL",
    };

    const teamWhere: Prisma.ThreadWhereInput = {
      ...sharedWhere,
      type: "TEAM",
    };

    const matchWhere: Prisma.ThreadWhereInput = {
      ...sharedWhere,
      type: "MATCH",
      openAt: { lte: now },
    };

    let where: Prisma.ThreadWhereInput;
    if (type === "MATCH") {
      where = matchWhere;
    } else if (type === "GENERAL") {
      where = generalWhere;
    } else if (type === "TEAM") {
      where = teamWhere;
    } else {
      where = {
        ...sharedWhere,
        OR: [
          { type: "GENERAL" },
          { type: "TEAM" },
          { type: "MATCH", openAt: { lte: now } },
        ],
      };
    }

    const [threads, total, generalCount, teamCount, matchCount, distinctTags] = await Promise.all([
      prisma.thread.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
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
      prisma.thread.count({ where: generalWhere }),
      prisma.thread.count({ where: teamWhere }),
      prisma.thread.count({ where: matchWhere }),
      prisma.threadTag.findMany({
        where: { thread: { is: where } },
        select: { tagId: true },
        distinct: ["tagId"],
      }),
    ]);

    return NextResponse.json({
      threads,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        distinctTags: distinctTags.length,
        byType: {
          GENERAL: generalCount,
          TEAM: teamCount,
          MATCH: matchCount,
        },
      },
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
