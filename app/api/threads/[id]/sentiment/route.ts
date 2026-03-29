import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";
import { analyzeSentiment } from "@/lib/aiModeration";

type RawSentimentScore = {
  label: string;
  score: number;
};

type NormalizedSentiment = "positive" | "negative" | "neutral";

function isRawSentimentScore(value: unknown): value is RawSentimentScore {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { label?: unknown; score?: unknown };
  return (
    typeof candidate.label === "string" &&
    typeof candidate.score === "number"
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Sign in as a user to view sentiment." },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1]?.trim();
    const authPayload = token ? verifyAccessToken(token) : null;
    if (!authPayload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    if (authPayload.role !== "USER") {
      return NextResponse.json(
        { error: "Sentiment is only available to signed-in users." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const threadId = Number(id);
    if (Number.isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
    }

    // must be a match thread
    const thread = await prisma.thread.findFirst({
      where: { id: threadId, isHidden: false, type: "MATCH" },
      include: {
        match: {
          include: {
            homeTeam: { select: { id: true, name: true } },
            awayTeam: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!thread?.match) {
      return NextResponse.json({ error: "Match thread not found" }, { status: 404 });
    }

    // get all visible posts
    const posts = await prisma.post.findMany({
      where: { threadId, isHidden: false, isDeleted: false },
      include: {
        author: {
          select: { id: true, favoriteTeamId: true },
        },
      },
    });

    if (posts.length === 0) {
      return NextResponse.json({
        threadId,
        overall: "neutral",
        totalPosts: 0,
        homeTeam: { id: thread.match.homeTeam.id, name: thread.match.homeTeam.name, sentiment: "neutral" },
        awayTeam: { id: thread.match.awayTeam.id, name: thread.match.awayTeam.name, sentiment: "neutral" },
      });
    }

    // analyze all posts
    const contents = posts.map((p) => p.content);
    const results = await analyzeSentiment(contents);

    if (!results) {
      return NextResponse.json({ error: "Sentiment analysis failed" }, { status: 502 });
    }

    function flattenSentimentScores(result: unknown): RawSentimentScore[] {
      if (Array.isArray(result)) {
        if (
          result.length > 0 &&
          Array.isArray(result[0]) &&
          result[0].every(isRawSentimentScore)
        ) {
          return result[0];
        }

        return result.filter(isRawSentimentScore);
      }

      if (isRawSentimentScore(result)) {
        return [result];
      }

      return [];
    }

    function getTopSentimentLabel(result: unknown): NormalizedSentiment {
      const scores = flattenSentimentScores(result);

      if (!scores.length) {
        return "neutral";
      }

      const top = scores.reduce((best, current) =>
        current.score > best.score ? current : best
      );

      const normalized = String(top.label).toLowerCase();
      if (normalized === "label_0") return "negative";
      if (normalized === "label_1") return "neutral";
      if (normalized === "label_2") return "positive";
      if (normalized.includes("pos")) return "positive";
      if (normalized.includes("neg")) return "negative";
      return "neutral";
    }

    // helper to compute sentiment label from normalized labels
    function computeSentiment(
      sentimentLabels: NormalizedSentiment[]
    ): NormalizedSentiment | "mixed" {
      if (!sentimentLabels.length) return "neutral";

      let positive = 0, negative = 0, neutral = 0;
      for (const label of sentimentLabels) {
        if (label === "positive") positive++;
        else if (label === "negative") negative++;
        else neutral++;
      }

      if (positive > negative && positive > neutral) return "positive";
      if (negative > positive && negative > neutral) return "negative";
      if (neutral > positive && neutral > negative) return "neutral";
      return "mixed";
    }

    // split posts by team fans, matching the PP1 requirement literally
    const homeTeamId = thread.match.homeTeam.id;
    const awayTeamId = thread.match.awayTeam.id;
    const classifiedPosts = posts.map((post, index) => ({
      post,
      sentiment: getTopSentimentLabel(results[index]),
    }));

    const homePosts = classifiedPosts
      .filter(({ post }) => post.author.favoriteTeamId === homeTeamId);

    const awayPosts = classifiedPosts
      .filter(({ post }) => post.author.favoriteTeamId === awayTeamId);

    return NextResponse.json({
      threadId,
      overall: computeSentiment(classifiedPosts.map((entry) => entry.sentiment)),
      totalPosts: posts.length,
      homeTeam: {
        id: homeTeamId,
        name: thread.match.homeTeam.name,
        sentiment: computeSentiment(homePosts.map((entry) => entry.sentiment)),
        fanPosts: homePosts.length,
      },
      awayTeam: {
        id: awayTeamId,
        name: thread.match.awayTeam.name,
        sentiment: computeSentiment(awayPosts.map((entry) => entry.sentiment)),
        fanPosts: awayPosts.length,
      },
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
