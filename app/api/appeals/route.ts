import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { parseJsonBody } from "@/lib/requestBody";

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticate(request, { allowRestricted: true });
    if (error) return error;

    const pendingAppeal = await prisma.appeal.findFirst({
      where: {
        userId: user.id,
        status: "PENDING",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        reason: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ appeal: pendingAppeal });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticate(request, { allowRestricted: true });
    if (error) return error;

    // only banned or suspended users can appeal
    if (user.status === "ACTIVE") {
      return NextResponse.json(
        { error: "Your account is not banned or suspended" },
        { status: 400 }
      );
    }

    // check if user already has a pending appeal
    const existingAppeal = await prisma.appeal.findFirst({
      where: { userId: user.id, status: "PENDING" },
    });

    if (existingAppeal) {
      return NextResponse.json(
        { error: "You already have a pending appeal" },
        { status: 409 }
      );
    }

    const { body, error: bodyError } = await parseJsonBody<{ reason?: string }>(request);
    if (bodyError) return bodyError;

    const { reason } = body ?? {};

    if (!reason) {
      return NextResponse.json({ error: "Reason is required" }, { status: 400 });
    }

    if (typeof reason !== "string") {
      return NextResponse.json({ error: "Reason must be a string" }, { status: 400 });
    }

    if (reason.trim().length < 1 || reason.trim().length > 1000) {
      return NextResponse.json(
        { error: "Reason must be between 1 and 1000 characters" },
        { status: 400 }
      );
    }

    const appeal = await prisma.appeal.create({
      data: {
        userId: user.id,
        reason: reason.trim(),
      },
    });

    return NextResponse.json(appeal, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
