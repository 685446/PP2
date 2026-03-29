import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { parseJsonBody } from "@/lib/requestBody";

type VotePollRequestBody = {
  pollOptionId?: unknown;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
            id: true,
            isHidden: true,
          },
        },
        options: true,
      },
    });

    if (!poll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    if (poll.thread?.isHidden) {
      return NextResponse.json(
        { error: "Poll is unavailable" },
        { status: 403 }
      );
    }

    // check poll is still open
    if (new Date() >= poll.deadline) {
      return NextResponse.json({ error: "Poll is closed" }, { status: 403 });
    }

    const { body, error: bodyError } =
      await parseJsonBody<VotePollRequestBody>(request);
    if (bodyError) return bodyError;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { pollOptionId } = body;

    if (pollOptionId === undefined || pollOptionId === null) {
      return NextResponse.json({ error: "pollOptionId is required" }, { status: 400 });
    }

    if (typeof pollOptionId !== "number") {
      return NextResponse.json({ error: "Invalid pollOptionId" }, { status: 400 });
    }

    // check option belongs to this poll
    const option = poll.options.find((o) => o.id === pollOptionId);
    if (!option) {
      return NextResponse.json({ error: "Option not found" }, { status: 404 });
    }

    const existingVote = await prisma.pollVote.findFirst({
      where: {
        userId: user.id,
        pollOptionId: {
          in: poll.options.map((o) => o.id),
        }
      }
    });

    if (existingVote?.pollOptionId === pollOptionId) {
      const unchangedPoll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: {
          options: {
            include: {
              _count: {
                select: { votes: true }
              }
            }
          }
        }
      });

      if (!unchangedPoll) {
        return NextResponse.json({ error: "Poll not found" }, { status: 404 });
      }

      const totalVotes = unchangedPoll.options.reduce((sum, o) => sum + o._count.votes, 0);
      const options = unchangedPoll.options
        .map((o) => ({
          id: o.id,
          text: o.text,
          voteCount: o._count.votes,
          percentage: totalVotes === 0
            ? 0
            : Math.round((o._count.votes / totalVotes) * 100),
        }))
        .sort((a, b) => b.voteCount - a.voteCount);

      return NextResponse.json({
        message: "Vote unchanged",
        pollOptionId,
        poll: {
          id: unchangedPoll.id,
          question: unchangedPoll.question,
          deadline: unchangedPoll.deadline,
          options,
          totalVotes,
          currentUserVoteOptionId: pollOptionId,
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.pollVote.deleteMany({
        where: {
          userId: user.id,
          pollOptionId: {
            in: poll.options.map((o) => o.id),
          },
        },
      });

      await tx.pollVote.create({
        data: {
          userId: user.id,
          pollOptionId,
        },
      });
    });

    const updatedPoll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        options: {
          include: {
            _count: {
              select: { votes: true }
            }
          }
        }
      }
    });

    if (!updatedPoll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    const totalVotes = updatedPoll.options.reduce((sum, o) => sum + o._count.votes, 0);

    const options = updatedPoll.options
    .map((o) => ({
      id: o.id,
      text: o.text,
      voteCount: o._count.votes,
      percentage: totalVotes === 0
        ? 0
        : Math.round((o._count.votes / totalVotes) * 100),
    }))
    .sort((a, b) => b.voteCount - a.voteCount);

    return NextResponse.json({
      message: existingVote ? "Vote updated successfully" : "Vote recorded successfully",
      pollOptionId,
      poll: {
        id: updatedPoll.id,
        question: updatedPoll.question,
        deadline: updatedPoll.deadline,
        options,
        totalVotes,
        currentUserVoteOptionId: pollOptionId,
      },
    }, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
