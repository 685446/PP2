import { Prisma } from "@prisma/client";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

const DEFAULT_USER_REPORT_SUSPENSION_DAYS = 7;
const MAX_USER_REPORT_SUSPENSION_DAYS = 365;
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

    let requestedSuspensionDays = DEFAULT_USER_REPORT_SUSPENSION_DAYS;
    const rawBody = await request.text();

    if (rawBody.trim().length > 0) {
      let parsedBody: unknown;

      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      const suspensionDays = (parsedBody as { suspensionDays?: unknown })?.suspensionDays;
      if (suspensionDays !== undefined) {
        if (typeof suspensionDays !== "number") {
          return NextResponse.json(
            {
              error: `suspensionDays must be an integer between 1 and ${MAX_USER_REPORT_SUSPENSION_DAYS}`,
            },
            { status: 400 }
          );
        }

        if (
          !Number.isInteger(suspensionDays) ||
          suspensionDays < 1 ||
          suspensionDays > MAX_USER_REPORT_SUSPENSION_DAYS
        ) {
          return NextResponse.json(
            {
              error: `suspensionDays must be an integer between 1 and ${MAX_USER_REPORT_SUSPENSION_DAYS}`,
            },
            { status: 400 }
          );
        }

        requestedSuspensionDays = suspensionDays;
      }
    }

    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: {
        reportedUser: {
          select: {
            id: true,
            role: true,
            status: true,
            statusReason: true,
            suspendedUntil: true,
          },
        },
      },
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

    if (!report.postId && !report.threadId && !report.reportedUserId) {
      return NextResponse.json(
        { error: "Invalid report target" },
        { status: 400 }
      );
    }

    let actionTaken = "Report approved.";
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
        : {
            status: "PENDING" as const,
            targetType: "USER" as const,
            reportedUserId: report.reportedUserId,
          };

    if (report.postId) {
      actionTaken = "Report approved and post hidden.";
    } else if (report.threadId) {
      actionTaken = isPollReport(report.reason)
        ? "Report approved and poll hidden."
        : "Report approved and thread hidden.";
    } else if (report.reportedUserId) {
      if (!report.reportedUser) {
        return NextResponse.json({ error: "Reported user not found" }, { status: 404 });
      }

      if (report.reportedUser.role === "ADMIN") {
        return NextResponse.json(
          { error: "Admin accounts cannot be actioned through this report flow" },
          { status: 403 }
        );
      }

      if (report.reportedUser.status === "ACTIVE") {
        const suspendedUntil = new Date();
        suspendedUntil.setDate(suspendedUntil.getDate() + requestedSuspensionDays);

        actionTaken = `Report approved and account suspended for ${requestedSuspensionDays} days.`;
      } else if (report.reportedUser.status === "SUSPENDED") {
        actionTaken = "Report approved. Account is already suspended.";
      } else {
        actionTaken = "Report approved. Account is already banned.";
      }
    }

    const { updatedReport, resolvedRelatedReportsCount } = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const approvedReports = await tx.report.updateMany({
          where: relatedReportsWhere,
          data: { status: "APPROVED" },
        });

        if (report.postId) {
          await tx.post.update({
            where: { id: report.postId },
            data: { isHidden: true },
          });
        } else if (report.threadId) {
          await tx.thread.update({
            where: { id: report.threadId },
            data: { isHidden: true },
          });
        } else if (report.reportedUserId && report.reportedUser?.status === "ACTIVE") {
          const suspendedUntil = new Date();
          suspendedUntil.setDate(suspendedUntil.getDate() + requestedSuspensionDays);

          await tx.user.update({
            where: { id: report.reportedUserId },
            data: {
              status: "SUSPENDED",
              statusReason: report.reason.trim(),
              suspendedUntil,
            },
          });
        }

        const updatedReport = await tx.report.findUnique({
          where: { id: reportId },
        });

        return {
          updatedReport,
          resolvedRelatedReportsCount: Math.max(0, approvedReports.count - 1),
        };
      }
    );

    if (!updatedReport) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (resolvedRelatedReportsCount > 0) {
      const relatedLabel = report.postId
        ? "post reports"
        : report.threadId
          ? isPollReport(report.reason)
            ? "poll reports"
            : "thread reports"
          : "user reports";
      actionTaken += ` Resolved ${resolvedRelatedReportsCount} related ${relatedLabel}.`;
    }

    return NextResponse.json({
      report: updatedReport,
      actionTaken,
      resolvedRelatedReportsCount,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
