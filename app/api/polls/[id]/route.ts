import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";
import { authenticate } from "@/lib/middleware";
import { buildThreadModerationText, syncAutoModerationReport } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";

function validateQuestion(question: unknown) {
  if (typeof question !== "string") {
    return "Question must be a string";
  }

  if (question.trim().length < 1 || question.trim().length > 200) {
    return "Question must be between 1 and 200 characters";
  }

  return null;
}

function validateOptions(options: unknown) {
  if (!Array.isArray(options)) {
    return "Options must be an array";
  }

  if (options.length < 2 || options.length > 10) {
    return "Poll must have between 2 and 10 options";
  }

  if (
    !options.every(
      (option) =>
        typeof option === "string" &&
        option.trim().length > 0 &&
        option.trim().length <= 100
    )
  ) {
    return "Each option must be between 1 and 100 characters";
  }

  const uniqueOptions = [...new Set(options.map((option) => option.trim().toLowerCase()))];
  if (uniqueOptions.length !== options.length) {
    return "Poll options must be unique";
  }

  return null;
}

function validateDeadline(deadline: unknown, now: Date) {
  if (
    typeof deadline !== "string" &&
    typeof deadline !== "number" &&
    !(deadline instanceof Date)
  ) {
    return { error: "Invalid deadline date", deadlineDate: null };
  }

  const deadlineDate = new Date(deadline);

  if (Number.isNaN(deadlineDate.getTime())) {
    return { error: "Invalid deadline date", deadlineDate: null };
  }

  if (deadlineDate <= now) {
    return { error: "Deadline must be in the future", deadlineDate: null };
  }

  return { error: null, deadlineDate };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1];
      if (!verifyAccessToken(token)) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing poll id" }, { status: 400 });
    }

    const pollId = Number(id);
    if (Number.isNaN(pollId)) {
      return NextResponse.json({ error: "Invalid poll id" }, { status: 400 });
    }

    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        thread: {
          select: {
            isHidden: true,
          },
        },
        author: {
          select: { id: true, username: true, avatar: true },
        },
        options: {
          include: {
            _count: {
              select: { votes: true },
            },
          }
        },
      },
    });

    if (!poll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    if (poll.thread?.isHidden) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    const now = new Date();
    const isOpen = now < poll.deadline;
    const totalVotes = poll.options.reduce(
      (sum: number, o: { _count: { votes: number } }) => sum + o._count.votes,
      0
    );

    const options = poll.options.map((o: {
      id: number;
      text: string;
      _count: { votes: number };
    }) => ({
      ...o,
      voteCount: o._count.votes,
      percentage:
        totalVotes === 0
          ? 0
          : Math.round((o._count.votes / totalVotes) * 100)
    }))
    .sort((a: { voteCount: number }, b: { voteCount: number }) => b.voteCount - a.voteCount);

    return NextResponse.json({
      id: poll.id,
      question: poll.question,
      deadline: poll.deadline,
      author: poll.author,
      options,
      totalVotes,
      isOpen,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        thread: true,
        options: {
          include: {
            _count: {
              select: { votes: true },
            },
          },
        },
      },
    });

    if (!poll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    if (poll.thread?.isHidden) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    if (poll.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    if (now < poll.thread.openAt) {
      return NextResponse.json({ error: "Thread is not open yet" }, { status: 403 });
    }
    if (poll.thread.closedAt && now > poll.thread.closedAt) {
      return NextResponse.json({ error: "Thread is closed" }, { status: 403 });
    }

    const { body, error: bodyError } = await parseJsonBody<{
      question?: unknown;
      options?: unknown;
      deadline?: unknown;
    }>(request);
    if (bodyError) return bodyError;

    const { question, options, deadline } = body ?? {};

    if (question === undefined && options === undefined && deadline === undefined) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    if (question !== undefined) {
      const questionError = validateQuestion(question);
      if (questionError) {
        return NextResponse.json({ error: questionError }, { status: 400 });
      }
    }

    if (options !== undefined) {
      const optionsError = validateOptions(options);
      if (optionsError) {
        return NextResponse.json({ error: optionsError }, { status: 400 });
      }
    }

    let deadlineDate = null;
    if (deadline !== undefined) {
      const deadlineValidation = validateDeadline(deadline, now);
      if (deadlineValidation.error) {
        return NextResponse.json({ error: deadlineValidation.error }, { status: 400 });
      }
      deadlineDate = deadlineValidation.deadlineDate;
    }

    const normalizedQuestion = typeof question === "string" ? question.trim() : undefined;
    const normalizedOptions = Array.isArray(options)
      ? options.map((text: string) => text.trim())
      : undefined;

    const totalVotes = poll.options.reduce(
      (sum: number, option: { _count: { votes: number } }) => sum + option._count.votes,
      0
    );
    if (options !== undefined && totalVotes > 0) {
      return NextResponse.json(
        { error: "Poll options cannot be changed after voting has started" },
        { status: 409 }
      );
    }

    const updateData: Prisma.PollUpdateInput = {};
    if (normalizedQuestion !== undefined) {
      updateData.question = normalizedQuestion;
    }
    if (deadline !== undefined && deadlineDate) {
      updateData.deadline = deadlineDate;
    }
    if (normalizedOptions !== undefined) {
      updateData.options = {
        deleteMany: {},
        create: normalizedOptions.map((text: string) => ({ text })),
      };
    }

    await prisma.poll.update({
      where: { id: pollId },
      data: updateData,
    });

    const updatedPoll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        author: {
          select: { id: true, username: true, avatar: true },
        },
        options: true,
      },
    });

    if (!updatedPoll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    await syncAutoModerationReport({
      targetType: "THREAD",
      threadId: poll.threadId,
      text: buildThreadModerationText({
        title: poll.thread.title,
        body: poll.thread.body,
        pollQuestion: updatedPoll.question,
        pollOptions: updatedPoll.options.map((option: { text: string }) => option.text),
      }),
      contentType: "poll",
      source: "poll edit",
    });

    return NextResponse.json(updatedPoll);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        thread: {
          select: {
            isHidden: true,
          },
        },
        options: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!poll || poll.thread?.isHidden) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    if (poll.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const optionIds = poll.options.map((option) => option.id);

    await prisma.$transaction(async (tx) => {
      if (optionIds.length > 0) {
        await tx.pollVote.deleteMany({
          where: {
            pollOptionId: {
              in: optionIds,
            },
          },
        });
      }

      await tx.pollOption.deleteMany({
        where: { pollId },
      });

      await tx.poll.delete({
        where: { id: pollId },
      });
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
