import { Prisma } from "@prisma/client";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

const POLL_REPORT_PREFIX = "Poll report:";

function isPollReport(reason: string) {
  return reason.startsWith(POLL_REPORT_PREFIX);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing report id" }, { status: 400 });
    }

    const reportId = Number(id);
    if (Number.isNaN(reportId)) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let dismissRelated = false;
    const rawBody = await request.text();

    if (rawBody.trim().length > 0) {
      let parsedBody: unknown;

      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      dismissRelated = (parsedBody as { dismissRelated?: unknown })?.dismissRelated === true;
    }

    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.status !== "PENDING") {
      return NextResponse.json(
        { error: "Report has already been resolved" },
        { status: 409 }
      );
    }

    const relatedReportsWhere = report.postId
      ? {
          status: "PENDING" as const,
          targetType: "POST" as const,
          postId: report.postId,
        }
      : report.threadId
        ? isPollReport(report.reason)
          ? {
              status: "PENDING" as const,
              targetType: "THREAD" as const,
              threadId: report.threadId,
              reason: {
                startsWith: POLL_REPORT_PREFIX,
              },
            }
          : {
              status: "PENDING" as const,
              targetType: "THREAD" as const,
              threadId: report.threadId,
              NOT: {
                reason: {
                  startsWith: POLL_REPORT_PREFIX,
                },
              },
            }
        : report.reportedUserId
          ? {
              status: "PENDING" as const,
              targetType: "USER" as const,
              reportedUserId: report.reportedUserId,
            }
          : null;

    if (dismissRelated && !relatedReportsWhere) {
      return NextResponse.json({ error: "Invalid report target" }, { status: 400 });
    }

    let updated;
    let dismissedRelatedReportsCount = 0;

    if (dismissRelated && relatedReportsWhere) {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const dismissedReports = await tx.report.updateMany({
          where: relatedReportsWhere,
          data: { status: "DISMISSED" },
        });

        const updated = await tx.report.findUnique({
          where: { id: reportId },
        });

        return {
          updated,
          dismissedRelatedReportsCount: Math.max(0, dismissedReports.count - 1),
        };
      });

      updated = result.updated;
      dismissedRelatedReportsCount = result.dismissedRelatedReportsCount;
    } else {
      updated = await prisma.report.update({
        where: { id: reportId },
        data: { status: "DISMISSED" },
      });
    }

    if (!updated) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    let actionTaken = "Report rejected.";
    if (dismissRelated && dismissedRelatedReportsCount > 0) {
      const relatedLabel = report.postId
        ? "post reports"
        : report.threadId
          ? isPollReport(report.reason)
            ? "poll reports"
            : "thread reports"
          : "user reports";
      actionTaken = `Report rejected. Dismissed ${dismissedRelatedReportsCount} related ${relatedLabel}.`;
    } else if (dismissRelated) {
      actionTaken = "Report rejected. No other related pending reports were found.";
    }

    return NextResponse.json({
      report: updated,
      actionTaken,
      dismissedRelatedReportsCount,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
