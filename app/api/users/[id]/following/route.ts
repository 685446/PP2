import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    let viewerUserId: number | null = null;

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1];
      const tokenPayload = verifyAccessToken(token);
      if (!tokenPayload) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }

      const parsedViewerId = Number(
        tokenPayload.userId ?? tokenPayload.id ?? tokenPayload.sub
      );
      if (Number.isInteger(parsedViewerId) && parsedViewerId > 0) {
        viewerUserId = parsedViewerId;
      }
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const userId = Number(id);
    if (Number.isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const q = searchParams.get("q")?.trim() || "";
    const skip = (page - 1) * limit;
    const where: Prisma.FollowWhereInput = {
      followerId: userId,
      ...(q
        ? {
            following: {
              username: {
                contains: q,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          }
        : {}),
    };

    const [following, total] = await Promise.all([
      prisma.follow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          following: {
            select: { id: true, username: true, avatar: true },
          },
        },
      }),
      prisma.follow.count({ where }),
    ]);

    const followingIds = following.map((entry) => entry.following.id);
    const viewerFollowedIds = viewerUserId && followingIds.length > 0
      ? new Set(
          (
            await prisma.follow.findMany({
              where: {
                followerId: viewerUserId,
                followingId: {
                  in: followingIds,
                },
              },
              select: {
                followingId: true,
              },
            })
          ).map((entry) => entry.followingId)
        )
      : new Set();

    return NextResponse.json({
      following: following.map((f) => ({
        ...f.following,
        followedAt: f.createdAt,
        isFollowing: viewerFollowedIds.has(f.following.id),
      })),
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
