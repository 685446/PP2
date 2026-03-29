import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { enforceReportAbuseProtection } from "@/lib/reportAbuse";
import { parseJsonBody } from "@/lib/requestBody";

type PostReportRequestBody = {
  reason?: unknown;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing post id" }, { status: 400 });
    }

    const postId = Number(id);
    if (Number.isNaN(postId)) {
      return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    const post = await prisma.post.findFirst({
      where: { id: postId, isHidden: false, isDeleted: false },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // can't report your own post
    if (post.authorId === user.id) {
      return NextResponse.json(
        { error: "You cannot report your own post" },
        { status: 400 }
      );
    }

    const { body, error: bodyError } =
      await parseJsonBody<PostReportRequestBody>(request);
    if (bodyError) return bodyError;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { reason } = body;

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

    // check if user already reported this post
    const existingReport = await prisma.report.findFirst({
      where: { reporterId: user.id, postId },
    });

    if (existingReport) {
      return NextResponse.json(
        { error: "You have already reported this post" },
        { status: 409 }
      );
    }

    const abuseError = await enforceReportAbuseProtection(request, user.id);
    if (abuseError) return abuseError;

    const report = await prisma.report.create({
      data: {
        reporterId: user.id,
        targetType: "POST",
        postId,
        reason: reason.trim(),
      },
    });

    return NextResponse.json(report, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
