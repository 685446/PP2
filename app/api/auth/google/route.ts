import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import {
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
} from "@/lib/auth";
import { parseJsonBody } from "@/lib/requestBody";

type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string;
};

type GoogleAuthRequest = {
  credential?: unknown;
  favoriteTeamId?: unknown;
};

const DEFAULT_AVATARS = [
  "/avatars/default1.png",
  "/avatars/default2.png",
  "/avatars/default3.png",
  "/avatars/default4.png",
  "/avatars/default5.png",
  "/avatars/default6.png",
];

function pickDefaultAvatar(): string {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)];
}

function normalizeUsernameBase(email: string): string {
  const local = email.split("@")[0] ?? "user";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const compact = cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const base = compact.length >= 3 ? compact : `user_${compact}`.slice(0, 12);
  return base.slice(0, 24) || "user";
}

async function makeUniqueUsername(base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;

  while (true) {
    const existing = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!existing) return candidate;

    const tag = String(suffix);
    const trimmedBase = base.slice(0, Math.max(3, 30 - tag.length));
    candidate = `${trimmedBase}${tag}`;
    suffix += 1;
  }
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo | null> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { method: "GET", cache: "no-store" }
  );

  if (!response.ok) return null;
  return (await response.json()) as GoogleTokenInfo;
}

export async function POST(request: NextRequest) {
  try {
    const googleClientId =
      process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

    if (!googleClientId) {
      return NextResponse.json(
        { error: "Google authentication is not configured" },
        { status: 500 }
      );
    }

    const { body, error: bodyError } = await parseJsonBody(request);
    if (bodyError) return bodyError;

    const { credential, favoriteTeamId } = (body ?? {}) as GoogleAuthRequest;

    if (!credential || typeof credential !== "string") {
      return NextResponse.json(
        { error: "Google credential is required" },
        { status: 400 }
      );
    }

    let parsedFavoriteTeamId: number | null = null;
    if (favoriteTeamId !== undefined && favoriteTeamId !== null) {
      if (typeof favoriteTeamId !== "number" || !Number.isInteger(favoriteTeamId)) {
        return NextResponse.json(
          { error: "favoriteTeamId must be an integer or null" },
          { status: 400 }
        );
      }

      const team = await prisma.team.findUnique({
        where: { id: favoriteTeamId },
        select: { id: true },
      });
      if (!team) {
        return NextResponse.json(
          { error: "Favorite team not found" },
          { status: 404 }
        );
      }

      parsedFavoriteTeamId = favoriteTeamId;
    }

    const tokenInfo = await verifyGoogleIdToken(credential);
    if (!tokenInfo) {
      return NextResponse.json(
        { error: "Invalid Google credential" },
        { status: 401 }
      );
    }

    if (tokenInfo.aud !== googleClientId) {
      return NextResponse.json(
        { error: "Google credential audience mismatch" },
        { status: 401 }
      );
    }

    if (tokenInfo.email_verified !== "true" || !tokenInfo.email) {
      return NextResponse.json(
        { error: "Google account email is not verified" },
        { status: 401 }
      );
    }

    const normalizedEmail = tokenInfo.email.toLowerCase().trim();
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      const usernameBase = normalizeUsernameBase(normalizedEmail);
      const username = await makeUniqueUsername(usernameBase);
      const passwordHash = await hashPassword(randomUUID());

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          username,
          passwordHash,
          avatar: pickDefaultAvatar(),
          favoriteTeamId: parsedFavoriteTeamId,
        },
      });
    } else if (
      parsedFavoriteTeamId !== null &&
      (user.favoriteTeamId === null || user.favoriteTeamId === undefined)
    ) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { favoriteTeamId: parsedFavoriteTeamId },
      });
    }

    const hadAccountRestoredNotice = user.appealApprovedNoticePending;
    let accountRestoredNoticePending = hadAccountRestoredNotice;

    if (
      user.status === "SUSPENDED" &&
      user.suspendedUntil &&
      user.suspendedUntil <= new Date()
    ) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { status: "ACTIVE", statusReason: "", suspendedUntil: null },
      });
      accountRestoredNoticePending = true;
    }

    if (hadAccountRestoredNotice) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { appealApprovedNoticePending: false },
      });
    }

    const payload = { userId: user.id, role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    return NextResponse.json({
      accessToken,
      refreshToken,
      expiresIn: Number(process.env.JWT_EXPIRES_IN_SECONDS),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
        statusReason: user.statusReason,
        suspendedUntil: user.suspendedUntil,
        accountRestoredNoticePending,
        favoriteTeamId: user.favoriteTeamId,
        authProvider: "GOOGLE",
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
