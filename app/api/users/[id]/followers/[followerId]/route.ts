import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; followerId: string }> }
) {
  try {
    const { id, followerId } = await params;

    if (!id || !followerId) {
      return NextResponse.json({ error: "Missing user id or follower id" }, { status: 400 });
    }

    const userId = Number(id);
    const followerIdNum = Number(followerId);

    if (Number.isNaN(userId) || Number.isNaN(followerIdNum)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    // can only remove your own followers
    if (user.id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // check follow exists
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: followerIdNum,
          followingId: userId,
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "This user is not following you" },
        { status: 404 }
      );
    }

    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: followerIdNum,
          followingId: userId,
        },
      },
    });

    return NextResponse.json({
      message: "Follower removed successfully",
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
