import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { hashPassword } from "@/lib/auth";
import { parseJsonBody } from "@/lib/requestBody";

type RegisterRequestBody = {
  email?: unknown;
  username?: unknown;
  password?: unknown;
  favoriteTeamId?: unknown;
  acceptTerms?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const { body, error: bodyError } = await parseJsonBody(request);
    if (bodyError) return bodyError;

    const {
      email,
      username,
      password,
      favoriteTeamId,
      acceptTerms,
    } = (body ?? {}) as RegisterRequestBody;

    // validate required fields
    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 }
      );
    }

    if (
      typeof email !== "string" ||
      typeof username !== "string" ||
      typeof password !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }


    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.trim();
    const passwordHasLetter = /[A-Za-z]/.test(password);
    const passwordHasNumber = /\d/.test(password);

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Username validation 
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

    // Password validation
    if (password.length < 8 || password.length > 100) {
      return NextResponse.json(
        { error: "Password must be between 8 and 100 characters" },
        { status: 400 }
      );
    }

    if (!passwordHasLetter || !passwordHasNumber) {
      return NextResponse.json(
        { error: "Password must include at least one letter and one number" },
        { status: 400 }
      );
    }

    if (acceptTerms !== true) {
      return NextResponse.json(
        { error: "You must accept the community guidelines to continue" },
        { status: 400 }
      );
    }


    // Favorite team validation
    if (favoriteTeamId !== undefined && favoriteTeamId !== null) {
      if (typeof favoriteTeamId !== "number") {
        return NextResponse.json(
          { error: "favoriteTeamId must be a number or null" },
          { status: 400 }
        );
      }

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

    // check if email already taken
    const existingEmail = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingEmail) {
      return NextResponse.json({ error: "Email already taken" }, { status: 409 });
    }

    // check if username already taken (case-insensitive)
    const existingUsername = await prisma.user.findFirst({
      where: {
        username: {
          equals: normalizedUsername,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (existingUsername) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    // pick random default avatar
    const defaultAvatars = [
      "/avatars/default1.png",
      "/avatars/default2.png",
      "/avatars/default3.png",
      "/avatars/default4.png",
      "/avatars/default5.png",
      "/avatars/default6.png",
    ];
    const avatar = defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];

    // create user
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash: await hashPassword(password),
        avatar,
        favoriteTeamId: favoriteTeamId ?? null,
      },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        role: true,
        status: true,
        favoriteTeamId: true,
        createdAt: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
