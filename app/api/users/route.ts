import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { SYSTEM_USER_USERNAME } from "@/lib/systemUser";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(30, Math.max(1, Number(searchParams.get("limit")) || 18));
    const skip = (page - 1) * limit;

    if (q.length > 100) {
      return NextResponse.json(
        { error: "Search query must be 100 characters or fewer" },
        { status: 400 }
      );
    }

    const where: Prisma.UserWhereInput = {
      NOT: {
        OR: [
          {
            username: {
              equals: SYSTEM_USER_USERNAME,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            username: {
              equals: "system",
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ],
      },
      ...(q
        ? {
            OR: [
              {
                username: {
                  contains: q,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                favoriteTeam: {
                  is: {
                    name: {
                      contains: q,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: q
          ? [{ username: "asc" }]
          : [{ createdAt: "desc" }],
        select: {
          id: true,
          username: true,
          avatar: true,
          status: true,
          favoriteTeam: {
            select: {
              id: true,
              name: true,
              crestUrl: true,
            },
          },
          _count: {
            select: {
              followers: true,
              following: true,
              threads: true,
              posts: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
