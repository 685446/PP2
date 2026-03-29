import { Prisma, ReportStatus, ReportTargetType } from "@prisma/client";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { buildThreadModerationText, getModerationVerdict } from "@/lib/aiModeration";

const POLL_REPORT_PREFIX = "Poll report:";

function getVerdictPriority(verdict: string) {
  if (verdict === "LIKELY_INAPPROPRIATE") return 3;
  if (verdict === "REVIEW_RECOMMENDED") return 2;
  if (verdict === "LIKELY_APPROPRIATE") return 1;
  return 0;
}

const reportQueueInclude = {
  reporter: {
    select: { id: true, username: true, avatar: true },
  },
  reportedUser: {
    select: {
      id: true,
      username: true,
      status: true,
      statusReason: true,
      suspendedUntil: true,
    },
  },
  post: {
    select: {
      id: true,
      content: true,
      threadId: true,
      authorId: true,
      author: {
        select: { id: true, username: true },
      },
    },
  },
  thread: {
    select: {
      id: true,
      title: true,
      body: true,
      isHidden: true,
      authorId: true,
      poll: {
        select: {
          question: true,
          options: {
            select: { text: true },
          },
        },
      },
      author: {
        select: { id: true, username: true },
      },
    },
  },
} satisfies Prisma.ReportInclude;

type QueueReportRecord = Prisma.ReportGetPayload<{
  include: typeof reportQueueInclude;
}>;

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "PENDING";
    const targetType = searchParams.get("targetType");
    const threadReportType = searchParams.get("threadReportType");
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const aiVerdict = searchParams.get("aiVerdict");
    const sortBy = searchParams.get("sortBy") || "aiVerdict";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const skip = (page - 1) * limit;

    const validStatuses = ["PENDING", "DISMISSED", "APPROVED"] as const;
    if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const parsedStatus = status as ReportStatus;

    const validTargetTypes = ["POST", "THREAD", "USER"] as const;
    if (targetType && !validTargetTypes.includes(targetType as (typeof validTargetTypes)[number])) {
      return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
    }
    const parsedTargetType = targetType ? (targetType as ReportTargetType) : null;

    const validThreadReportTypes = ["POLL", "THREAD"];
    if (threadReportType && !validThreadReportTypes.includes(threadReportType)) {
      return NextResponse.json({ error: "Invalid threadReportType" }, { status: 400 });
    }

    if (threadReportType && targetType && targetType !== "THREAD") {
      return NextResponse.json(
        { error: "threadReportType can only be used with thread reports" },
        { status: 400 }
      );
    }

    const reportWhere: Prisma.ReportWhereInput = {
      status: parsedStatus,
      ...(parsedTargetType ? { targetType: parsedTargetType } : {}),
      ...(threadReportType === "POLL"
        ? {
            targetType: "THREAD" as const,
            reason: {
              startsWith: POLL_REPORT_PREFIX,
            },
          }
        : threadReportType === "THREAD"
          ? {
              targetType: "THREAD" as const,
              NOT: {
                reason: {
                  startsWith: POLL_REPORT_PREFIX,
                },
              },
            }
          : {}),
    };

    const validVerdicts = [
      "LIKELY_INAPPROPRIATE",
      "REVIEW_RECOMMENDED",
      "LIKELY_APPROPRIATE",
      "UNAVAILABLE",
    ];
    if (aiVerdict && !validVerdicts.includes(aiVerdict)) {
      return NextResponse.json({ error: "Invalid aiVerdict" }, { status: 400 });
    }

    const validSortFields = ["aiVerdict", "reportCount", "createdAt"];
    if (!validSortFields.includes(sortBy)) {
      return NextResponse.json({ error: "Invalid sortBy" }, { status: 400 });
    }

    if (!["asc", "desc"].includes(sortOrder)) {
      return NextResponse.json({ error: "Invalid sortOrder" }, { status: 400 });
    }

    const [
      reports,
      directThreadReportCounts,
      pollThreadReportCounts,
      postReportCounts,
      userReportCounts,
    ] = await Promise.all([
      prisma.report.findMany({
        where: reportWhere,
        orderBy: { createdAt: "desc" },
        include: reportQueueInclude,
      }),
      prisma.report.groupBy({
        by: ["threadId"],
        where: {
          status: parsedStatus,
          targetType: "THREAD",
          threadId: { not: null },
          NOT: {
            reason: {
              startsWith: POLL_REPORT_PREFIX,
            },
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.report.groupBy({
        by: ["threadId"],
        where: {
          status: parsedStatus,
          targetType: "THREAD",
          threadId: { not: null },
          reason: {
            startsWith: POLL_REPORT_PREFIX,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.report.groupBy({
        by: ["postId"],
        where: {
          status: parsedStatus,
          targetType: "POST",
          postId: { not: null },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.report.groupBy({
        by: ["reportedUserId"],
        where: {
          status: parsedStatus,
          targetType: "USER",
          reportedUserId: { not: null },
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const directThreadReportCountMap = new Map<number, number>(
      directThreadReportCounts
        .flatMap((reportGroup) =>
          reportGroup.threadId === null
            ? []
            : ([[reportGroup.threadId, reportGroup._count._all] as const])
        )
    );
    const pollThreadReportCountMap = new Map<number, number>(
      pollThreadReportCounts
        .flatMap((reportGroup) =>
          reportGroup.threadId === null
            ? []
            : ([[reportGroup.threadId, reportGroup._count._all] as const])
        )
    );
    const postReportCountMap = new Map<number, number>(
      postReportCounts
        .flatMap((reportGroup) =>
          reportGroup.postId === null
            ? []
            : ([[reportGroup.postId, reportGroup._count._all] as const])
        )
    );
    const userReportCountMap = new Map<number, number>(
      userReportCounts
        .flatMap((reportGroup) =>
          reportGroup.reportedUserId === null
            ? []
            : ([[reportGroup.reportedUserId, reportGroup._count._all] as const])
        )
    );

    const reportsWithContext = await Promise.all(
      (reports as QueueReportRecord[]).map(async (report) => {
        const associatedThreadId = report.threadId ?? report.post?.threadId ?? null;
        const isPollReport =
          report.targetType === "THREAD" &&
          typeof report.reason === "string" &&
          report.reason.startsWith(POLL_REPORT_PREFIX);
        const userReportCount = report.reportedUserId
          ? userReportCountMap.get(report.reportedUserId) ?? 0
          : 0;
        const exactReportCount = report.postId
          ? postReportCountMap.get(report.postId) ?? 0
          : report.threadId
            ? isPollReport
              ? pollThreadReportCountMap.get(report.threadId) ?? 0
              : directThreadReportCountMap.get(report.threadId) ?? 0
            : report.reportedUserId
              ? userReportCount
              : 0;
        const isUserReport = Boolean(report.reportedUserId);

        const aiVerdict = isUserReport
          ? null
          : await getModerationVerdict(
              report.post
                ? report.post.content
                : buildThreadModerationText({
                    title: report.thread?.title,
                    body: report.thread?.body,
                    pollQuestion: report.thread?.poll?.question,
                    pollOptions:
                      report.thread?.poll?.options.map((option: { text: string }) => option.text) || [],
                  }),
              {
                contentType: report.post ? "post" : "thread",
              }
            );

        return {
          ...report,
          associatedThreadId,
          reportCount: exactReportCount,
          aiVerdict,
        };
      })
    );

    const filteredReports = aiVerdict
      ? reportsWithContext.filter((report) => report.aiVerdict?.verdict === aiVerdict)
      : reportsWithContext;

    const sortedReports = [...filteredReports].sort((a, b) => {
      let comparison = 0;
      const leftVerdict = a.aiVerdict?.verdict ?? "UNAVAILABLE";
      const rightVerdict = b.aiVerdict?.verdict ?? "UNAVAILABLE";

      if (sortBy === "aiVerdict") {
        comparison =
          getVerdictPriority(leftVerdict) - getVerdictPriority(rightVerdict);

        if (comparison === 0) {
          comparison = a.reportCount - b.reportCount;
        }
      } else if (sortBy === "reportCount") {
        comparison = a.reportCount - b.reportCount;

        if (comparison === 0) {
          comparison =
            getVerdictPriority(leftVerdict) - getVerdictPriority(rightVerdict);
        }
      } else {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }

      if (comparison === 0) {
        comparison = a.id - b.id;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    const paginatedReports = sortedReports.slice(skip, skip + limit);

    return NextResponse.json({
      reports: paginatedReports,
      total: filteredReports.length,
      page,
      limit,
      totalPages: Math.ceil(filteredReports.length / limit),
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
