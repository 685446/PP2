import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";

function parseIncludeRepliesParam(rawValue: string | null): boolean | null {
  if (rawValue === null) return true;

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function parseSortParam(rawValue: string | null): "newest" | "oldest" | null {
  if (rawValue === null) return "newest";

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "newest" || normalized === "oldest") return normalized;
  return null;
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

      const token = authHeader.split(" ")[1]?.trim();
      if (!token || !verifyAccessToken(token)) {
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
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    const includeReplies = parseIncludeRepliesParam(
      searchParams.get("includeReplies")
    );
    const sort = parseSortParam(searchParams.get("sort"));
    if (includeReplies === null) {
      return NextResponse.json(
        { error: "includeReplies must be true or false" },
        { status: 400 }
      );
    }
    if (sort === null) {
      return NextResponse.json(
        { error: "sort must be newest or oldest" },
        { status: 400 }
      );
    }

    const where = {
      authorId: userId,
      isHidden: false,
      isDeleted: false,
      ...(includeReplies ? {} : { parentId: null }),
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
        include: {
          edits: {
            orderBy: { editedAt: "desc" },
          },
          thread: {
            select: {
              id: true,
              title: true,
              type: true,
              teamId: true,
              matchId: true,
            },
          },
        },
      }),
      prisma.post.count({ where }),
    ]);

    const shapedPosts = posts.map((post) => ({
      ...post,
      isReply: post.parentId !== null,
    }));

    return NextResponse.json({
      posts: shapedPosts,
      includeReplies,
      sort,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
