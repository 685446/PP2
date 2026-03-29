import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const followingId = Number(id);
    if (Number.isNaN(followingId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    // can't follow yourself
    if (user.id === followingId) {
      return NextResponse.json(
        { error: "You cannot follow yourself" },
        { status: 400 }
      );
    }

    // check target user exists
    const target = await prisma.user.findUnique({
      where: { id: followingId },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // check already following
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Already following this user" },
        { status: 409 }
      );
    }

    await prisma.follow.create({
      data: {
        followerId: user.id,
        followingId,
      },
    });

    return NextResponse.json({ message: "Followed successfully" }, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const followingId = Number(id);
    if (Number.isNaN(followingId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    // check follow exists
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId,
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "You are not following this user" },
        { status: 404 }
      );
    }

    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId,
        },
      },
    });

    return new NextResponse(null, { status: 204 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
