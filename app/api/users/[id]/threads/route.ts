import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";

function parseSortParam(rawValue: string | null): "newest" | "oldest" | null {
  if (rawValue === null) return "newest";

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "newest" || normalized === "oldest") {
    return normalized;
  }

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
    const sort = parseSortParam(searchParams.get("sort"));

    if (sort === null) {
      return NextResponse.json(
        { error: "sort must be newest or oldest" },
        { status: 400 }
      );
    }

    const where = {
      authorId: userId,
      isHidden: false,
    };

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
        include: {
          team: {
            select: { id: true, name: true, crestUrl: true },
          },
          tags: {
            include: { tag: { select: { id: true, name: true } } },
          },
          match: {
            select: {
              id: true,
              homeTeamId: true,
              awayTeamId: true,
              utcDate: true,
              status: true,
            },
          },
          _count: {
            select: { posts: true },
          },
        },
      }),
      prisma.thread.count({ where }),
    ]);

    return NextResponse.json({
      threads,
      total,
      page,
      limit,
      sort,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
