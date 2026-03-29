import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";
import { authenticate } from "@/lib/middleware";
import { buildThreadModerationText, syncAutoModerationReport } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";

type UpdateThreadRequestBody = {
  title?: unknown;
  body?: unknown;
  tags?: unknown;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Missing thread id" }, 
        { status: 400 })
      ;
    }

    const threadId = Number(id);
    if (Number.isNaN(threadId)) {
      return NextResponse.json(
        { error: "Invalid thread id" }, 
        { status: 400 }
      );
    }

    const thread = await prisma.thread.findFirst({
      where: { id: threadId, isHidden: false },
      include: {
        author: {
          select: { id: true, username: true, avatar: true },
        },
        team: {
          select: { id: true, name: true, crestUrl: true },
        },
        tags: {
          include: { tag: true },
        },
        match: {
          select: { id: true, homeTeamId: true, awayTeamId: true, utcDate: true, status: true },
        },
        poll: {
          select: {
            id: true,
            question: true,
            deadline: true,
            authorId: true,
            author: {
              select: { id: true, username: true, avatar: true },
            },
            options: {
              select: {
                id: true,
                text: true,
                _count: {
                  select: { votes: true },
                },
              },
            },
          },
        },
        _count: {
          select: { posts: true },
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error:  "Thread not found" },
        { status: 404 }
      );
    }

    // Upcoming MATCH threads are hidden from direct reads until openAt.
    if (thread.type === "MATCH" && new Date() < thread.openAt) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    let currentUserVoteOptionId: number | null = null;
    const authHeader = request.headers.get("authorization");
    if (thread.poll && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1]?.trim();
      const payload = token ? verifyAccessToken(token) : null;

      if (payload?.userId) {
        const existingVote = await prisma.pollVote.findFirst({
          where: {
            userId: payload.userId,
            pollOptionId: {
              in: thread.poll.options.map((option) => option.id),
            },
          },
          select: {
            pollOptionId: true,
          },
        });

        currentUserVoteOptionId = existingVote?.pollOptionId ?? null;
      }
    }

    return NextResponse.json({
      ...thread,
      poll: thread.poll
        ? {
            ...thread.poll,
            currentUserVoteOptionId,
          }
        : null,
    });
    
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Missing thread id" }, 
        { status: 400 })
      ;
    }

    const threadId = Number(id);
    if (Number.isNaN(threadId)) {
      return NextResponse.json(
        { error: "Invalid thread id" }, 
        { status: 400 }
      );
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    const thread = await prisma.thread.findFirst({
      where: { id: threadId, isHidden: false },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" }, 
        { status: 404 }
      );
    }

    if (thread.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    if (thread.type === "MATCH" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" }, 
        { status: 403 }
      );
    }

    const { body: requestBody, error: bodyError } =
      await parseJsonBody<UpdateThreadRequestBody>(request);
    if (bodyError) return bodyError;
    if (!requestBody) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { title, body, tags } = requestBody;

    if (title === undefined && body === undefined && tags === undefined) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    if (title !== undefined) {
      if (typeof title !== "string") {
        return NextResponse.json(
          { error: "Title must be a string" }, 
          { status: 400 }
        );
      }
      if (title.trim().length < 1 || title.trim().length > 200) {
        return NextResponse.json(
          { error: "Title must be between 1 and 200 characters" },
          { status: 400 }
        );
      }
    }

    if (body !== undefined) {
      if (typeof body !== "string") {
        return NextResponse.json(
          { error: "Body must be a string" }, 
          { status: 400 }
        );
      }
      if (body.trim().length < 1 || body.trim().length > 10000) {
        return NextResponse.json(
          { error: "Body must be between 1 and 10000 characters" },
          { status: 400 }
        );
      }
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return NextResponse.json(
          { error: "Tags must be an array" }, 
          { status: 400 }
        );
      }
      if (tags.length > 5) {
        return NextResponse.json(
          { error: "Maximum 5 tags allowed" }, 
          { status: 400 }
        );
      }
      if (
        !tags.every(
          (tag): tag is string =>
            typeof tag === "string" &&
            tag.trim().length > 0 &&
            tag.trim().length <= 30
        )
      ) {
        return NextResponse.json(
          { error: "Each tag must be between 1 and 30 characters" },
          { status: 400 }
        );
      }
    }

    // update tags if provided
    let tagsUpdate = {};
    if (tags !== undefined) {
      const uniqueTags = [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];

      const tagRecords = await Promise.all(
        uniqueTags.map((name) =>
          prisma.tag.upsert({
            where: { name },
            update: {},
            create: { name },
          })
        )
      );

      tagsUpdate = {
        tags: {
          deleteMany: {},
          create: tagRecords.map((tag) => ({ tagId: tag.id })),
        },
      };
    }

    const updatedThread = await prisma.thread.update({
      where: { id: threadId },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(body !== undefined && { body: body.trim() }),
        ...tagsUpdate,
      },
      include: {
        author: {
          select: { id: true, username: true, avatar: true },
        },
        team: {
          select: { id: true, name: true, crestUrl: true },
        },
        tags: {
          include: { tag: true },
        },
      },
    });

    const moderationThread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        poll: {
          include: {
            options: {
              select: { text: true },
            },
          },
        },
      },
    });

    if (moderationThread) {
      await syncAutoModerationReport({
        targetType: "THREAD",
        threadId: moderationThread.id,
        text: buildThreadModerationText({
          title: moderationThread.title,
          body: moderationThread.body,
          pollQuestion: moderationThread.poll?.question,
          pollOptions: moderationThread.poll?.options.map((option) => option.text) || [],
        }),
        contentType: "thread",
        source: "thread edit",
      });
    }

    return NextResponse.json(updatedThread);

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Missing thread id" }, 
        { status: 400 })
      ;
    }

    const threadId = Number(id);
    if (Number.isNaN(threadId)) {
      return NextResponse.json(
        { error: "Invalid thread id" }, 
        { status: 400 }
      );
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    const thread = await prisma.thread.findFirst({
      where: { id: threadId, isHidden: false },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" }, 
        { status: 404 }
      );
    }

    if (thread.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    if (thread.type === "MATCH" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" }, 
        { status: 403 }
      );
    }

    await prisma.thread.update({
      where: { id: threadId },
      data: { isHidden: true}
    });

    return new NextResponse(null, { status: 204 });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
