import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { enforceReportAbuseProtection } from "@/lib/reportAbuse";
import { parseJsonBody } from "@/lib/requestBody";

const POLL_REPORT_PREFIX = "Poll report:";

export async function POST( request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing poll id" }, { status: 400 });
    }

    const pollId = Number(id);
    if (Number.isNaN(pollId)) {
      return NextResponse.json({ error: "Invalid poll id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    const poll = await prisma.poll.findFirst({
      where: {
        id: pollId,
        thread: {
          isHidden: false,
        },
      },
      include: {
        thread: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!poll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    if (poll.authorId === user.id) {
      return NextResponse.json(
        { error: "You cannot report your own poll" },
        { status: 400 }
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

    if (reason.trim().length < 1 || reason.trim().length > 500) {
      return NextResponse.json(
        { error: "Reason must be between 1 and 500 characters" },
        { status: 400 }
      );
    }

    const existingReport = await prisma.report.findFirst({
      where: {
        reporterId: user.id,
        threadId: poll.threadId,
        targetType: "THREAD",
        reason: {
          startsWith: POLL_REPORT_PREFIX,
        },
      },
    });

    if (existingReport) {
      return NextResponse.json(
        { error: "You have already reported this poll" },
        { status: 409 }
      );
    }

    const abuseError = await enforceReportAbuseProtection(request, user.id);
    if (abuseError) return abuseError;

    const report = await prisma.report.create({
      data: {
        reporterId: user.id,
        targetType: "THREAD",
        threadId: poll.threadId,
        reason: `${POLL_REPORT_PREFIX} ${reason.trim()}`,
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
