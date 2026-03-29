import { AppealStatus } from "@prisma/client";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

// GET /api/admin/appeals - view appeals queue (admin only)
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "PENDING";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    const validStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;
    if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const parsedStatus = status as AppealStatus;

    const [appeals, total] = await Promise.all([
      prisma.appeal.findMany({
        where: { status: parsedStatus },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              status: true,
              statusReason: true,
            },
          },
        },
      }),
      prisma.appeal.count({ where: { status: parsedStatus } }),
    ]);

    return NextResponse.json({
      appeals,
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
