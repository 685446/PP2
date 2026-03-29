import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { buildThreadModerationText, syncAutoModerationReport } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";

type CreatePollRequestBody = {
  question?: unknown;
  options?: unknown;
  deadline?: unknown;
};

export async function POST(
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
        { error:  "Thread not found" },
        { status: 404 }
      );
    }

    if (thread.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only the thread author can create a poll" },
        { status: 403 }
      );
    }

    // check thread is open
    const now = new Date();
    if (now < thread.openAt) {
      return NextResponse.json({ error: "Thread is not open yet" }, { status: 403 });
    }
    if (thread.closedAt && now > thread.closedAt) {
      return NextResponse.json({ error: "Thread is closed" }, { status: 403 });
    }

    const { body, error: bodyError } =
      await parseJsonBody<CreatePollRequestBody>(request);
    if (bodyError) return bodyError;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { question, options, deadline } = body;


    if (!question) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    if (typeof question !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    if (question.trim().length < 1 || question.trim().length > 200) {
      return NextResponse.json(
        { error: "Question must be between 1 and 200 characters" },
        { status: 400 }
      );
    }

    if (!options) {
      return NextResponse.json({ error: "Options are required" }, { status: 400 });
    }

    if (!Array.isArray(options)) {
      return NextResponse.json({ error: "Options must be an array" }, { status: 400 });
    }

    if (options.length < 2 || options.length > 10) {
      return NextResponse.json(
        { error: "Poll must have between 2 and 10 options" },
        { status: 400 }
      );
    }

    if (
      !options.every(
        (option): option is string =>
          typeof option === "string" &&
          option.trim().length > 0 &&
          option.trim().length <= 100
      )
    ) {
      return NextResponse.json(
        { error: "Each option must be between 1 and 100 characters" },
        { status: 400 }
      );
    }

    const uniqueOptions = [...new Set(options.map((option) => option.trim().toLowerCase()))];
    if (uniqueOptions.length !== options.length) {
      return NextResponse.json(
        { error: "Poll options must be unique" },
        { status: 400 }
      );
    }

    if (!deadline) {
      return NextResponse.json({ error: "Deadline is required" }, { status: 400 });
    }

    if (
      typeof deadline !== "string" &&
      typeof deadline !== "number" &&
      !(deadline instanceof Date)
    ) {
      return NextResponse.json({ error: "Invalid deadline date" }, { status: 400 });
    }

    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) {
      return NextResponse.json({ error: "Invalid deadline date" }, { status: 400 });
    }

    if (deadlineDate <= now) {
      return NextResponse.json(
        { error: "Deadline must be in the future" },
        { status: 400 }
      );
    }

    const existingPoll = await prisma.poll.findUnique({
      where: { threadId },
    });

    if (existingPoll) {
      return NextResponse.json(
        { error: "Thread already has a poll" },
        { status: 409 }
      );
    }

    const poll = await prisma.poll.create({
      data: {
        question: question.trim(),
        threadId,
        authorId: user.id,
        deadline: deadlineDate,
        options: {
          create: options.map((text) => ({ text: text.trim() })),
        },
      },
      include: {
        options: true,
        author: {
          select: { id: true, username: true, avatar: true },
        },
      }
    });

    await syncAutoModerationReport({
      targetType: "THREAD",
      threadId,
      text: buildThreadModerationText({
        title: thread.title,
        body: thread.body,
        pollQuestion: poll.question,
        pollOptions: poll.options.map((option) => option.text),
      }),
      contentType: "poll",
      source: "poll create",
    });

    return NextResponse.json(poll, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    );
  }
}
