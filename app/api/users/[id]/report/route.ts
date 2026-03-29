import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { enforceReportAbuseProtection } from "@/lib/reportAbuse";
import { parseJsonBody } from "@/lib/requestBody";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const reportedUserId = Number(id);
    if (Number.isNaN(reportedUserId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.id === reportedUserId) {
      return NextResponse.json(
        { error: "You cannot report your own account" },
        { status: 400 }
      );
    }

    const reportedUser = await prisma.user.findUnique({
      where: { id: reportedUserId },
      select: {
        id: true,
        username: true,
        role: true,
      },
    });

    if (!reportedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
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

    if (reason.trim().length < 1 || reason.trim().length > 500) {
      return NextResponse.json(
        { error: "Reason must be between 1 and 500 characters" },
        { status: 400 }
      );
    }

    const existingReport = await prisma.report.findFirst({
      where: {
        reporterId: user.id,
        targetType: "USER",
        reportedUserId,
      },
    });

    if (existingReport) {
      return NextResponse.json(
        { error: "You have already reported this user" },
        { status: 409 }
      );
    }

    const abuseError = await enforceReportAbuseProtection(request, user.id);
    if (abuseError) return abuseError;

    const report = await prisma.report.create({
      data: {
        reporterId: user.id,
        targetType: "USER",
        reportedUserId,
        reason: reason.trim(),
      },
      include: {
        reportedUser: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
