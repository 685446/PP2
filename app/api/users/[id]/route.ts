import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { verifyAccessToken } from "@/lib/auth";
import { parseJsonBody } from "@/lib/requestBody";
import { getTeamPalette } from "@/lib/teamPalette";

type UserRouteParams = {
  params: Promise<{ id: string }>;
};

type UpdateUserBody = {
  username?: unknown;
  avatar?: unknown;
  favoriteTeamId?: unknown;
};

type ProfileFavoriteTeam = {
  id: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
  palette?: Awaited<ReturnType<typeof getTeamPalette>>;
} | null;

// GET /api/users/:id - get user profile
export async function GET(request: NextRequest, { params }: UserRouteParams) {
  try {
    const authHeader = request.headers.get("authorization");
    let viewerUserId: number | null = null;

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1]?.trim();
      if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        avatar: true,
        role: true,
        status: true,
        favoriteTeamId: true,
        createdAt: true,
        favoriteTeam: {
          select: {
            id: true,
            name: true,
            shortName: true,
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
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    let isFollowing = false;
    if (viewerUserId && viewerUserId !== userId) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: viewerUserId,
            followingId: userId,
          },
        },
        select: { followerId: true },
      });
      isFollowing = Boolean(follow);
    }

    let favoriteTeamWithPalette: ProfileFavoriteTeam = user.favoriteTeam;
    if (user.favoriteTeam) {
      const palette = await getTeamPalette({
        id: user.favoriteTeam.id,
        name: user.favoriteTeam.name,
        crestUrl: user.favoriteTeam.crestUrl,
      });
      favoriteTeamWithPalette = { ...user.favoriteTeam, palette };
    }

    return NextResponse.json({
      ...user,
      favoriteTeam: favoriteTeamWithPalette,
      isFollowing,
      isSelf: viewerUserId === userId,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/users/:id - edit profile
export async function PATCH(request: NextRequest, { params }: UserRouteParams) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const userId = Number(id);
    if (Number.isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    // authenticate
    const { user, error } = await authenticate(request);
    if (error) return error;

    // only allow user to edit their own profile
    if (user.id !== userId) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    const { body, error: bodyError } = await parseJsonBody(request);
    if (bodyError) return bodyError;

    const { username, avatar, favoriteTeamId } = (body ?? {}) as UpdateUserBody;

    // empty body check
    if (
      username === undefined &&
      avatar === undefined &&
      favoriteTeamId === undefined
    ) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // username validation
    let normalizedUsername: string | undefined;

    if (username !== undefined) {
      if (typeof username !== "string") {
        return NextResponse.json(
          { error: "Username must be a string" },
          { status: 400 }
        );
      }

      normalizedUsername = username.trim();
      if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        return NextResponse.json(
          { error: "Username must be between 3 and 30 characters" },
          { status: 400 }
        );
      }

      if (!/^[A-Za-z0-9_]+$/.test(normalizedUsername)) {
        return NextResponse.json(
          { error: "Username can only contain letters, numbers, and underscores" },
          { status: 400 }
        );
      }

      // check uniqueness
      const existing = await prisma.user.findFirst({
        where: {
          username: {
            equals: normalizedUsername,
            mode: "insensitive",
          },
          NOT: { id: user.id },
        },
      });

      if (existing) {
        return NextResponse.json(
          { error: "Username already taken" },
          { status: 409 }
        );
      }
    }

    let normalizedAvatar: string | undefined;

    // avatar validation
    if (avatar !== undefined) {
      if (typeof avatar !== "string") {
        return NextResponse.json(
          { error: "Avatar must be a string" },
          { status: 400 }
        );
      }

      normalizedAvatar = avatar.trim();

      if (normalizedAvatar === "") {
        return NextResponse.json(
          { error: "Avatar cannot be empty" },
          { status: 400 }
        );
      }

      const isLocalPath = normalizedAvatar.startsWith("/");
      let isAbsoluteHttpUrl = false;

      if (!isLocalPath) {
        try {
          const parsed = new URL(normalizedAvatar);
          isAbsoluteHttpUrl =
            parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          isAbsoluteHttpUrl = false;
        }
      }

      if (!isLocalPath && !isAbsoluteHttpUrl) {
        return NextResponse.json(
          { error: "Invalid avatar. Use an absolute URL or a /path value." },
          { status: 400 }
        );
      }
    }

    // favoriteTeam validation
    if (favoriteTeamId !== undefined) {
      if (favoriteTeamId !== null && typeof favoriteTeamId !== "number") {
        return NextResponse.json(
          { error: "favoriteTeamId must be a number or null" },
          { status: 400 }
        );
      }

      if (favoriteTeamId !== null) {
        const team = await prisma.team.findUnique({
          where: { id: favoriteTeamId },
        });

        if (!team) {
          return NextResponse.json(
            { error: "Favorite team not found" },
            { status: 404 }
          );
        }
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(normalizedUsername !== undefined && { username: normalizedUsername }),
        ...(normalizedAvatar !== undefined && { avatar: normalizedAvatar }),
        ...(favoriteTeamId !== undefined && { favoriteTeamId }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        role: true,
        status: true,
        favoriteTeamId: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
