import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const matchId = Number(id);
    if (Number.isNaN(matchId)) {
      return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
    }

    const thread = await prisma.thread.findFirst({
      where: { matchId, isHidden: false },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        tags: { include: { tag: true } },
        _count: { select: { posts: true } },
      },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json(thread);

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
