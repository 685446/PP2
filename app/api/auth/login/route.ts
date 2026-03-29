import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { comparePassword, generateAccessToken, generateRefreshToken } from "@/lib/auth";
import { parseJsonBody } from "@/lib/requestBody";

export async function POST(request: NextRequest) {
  try {
    const { body, error: bodyError } = await parseJsonBody<{
      email?: string;
      password?: string;
    }>(request);
    if (bodyError) return bodyError;

    const { email, password } = body ?? {};

    // validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    // find user
    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // check password
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const hadAccountRestoredNotice = user.appealApprovedNoticePending;
    let accountRestoredNoticePending = hadAccountRestoredNotice;

    // auto-lift suspension if expired
    if (user.status === "SUSPENDED" && user.suspendedUntil && user.suspendedUntil <= new Date()) {
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

    // generate tokens
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
        authProvider: "LOCAL",
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
