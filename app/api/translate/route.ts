import { NextResponse, NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { translateToEnglish } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";
import { prisma } from "@/prisma/db";

const MAX_TRANSLATION_CHARS = 1500;

type TranslateRequestBody =
  | {
      postId: number;
      threadId?: never;
    }
  | {
      postId?: never;
      threadId: number;
    };

function splitIntoTranslationChunks(text: string, maxLength = MAX_TRANSLATION_CHARS) {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function translateLongText(text: string) {
  const chunks = splitIntoTranslationChunks(text);
  if (chunks.length === 0) return "";

  const translatedChunks: string[] = [];
  for (const chunk of chunks) {
    translatedChunks.push(await translateToEnglish(chunk));
  }

  return translatedChunks.join("\n\n").trim();
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Sign in as a user to use translation." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const authPayload = verifyAccessToken(token);
    if (!authPayload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    if (authPayload.role !== "USER") {
      return NextResponse.json(
        { error: "Translation is only available to signed-in users." },
        { status: 403 }
      );
    }

    const { body, error: bodyError } = await parseJsonBody(request);
    if (bodyError) return bodyError;

    const { postId, threadId } = body as Partial<TranslateRequestBody>;

    if ((postId === undefined && threadId === undefined) || (postId !== undefined && threadId !== undefined)) {
      return NextResponse.json(
        { error: "Provide exactly one of postId or threadId" },
        { status: 400 }
      );
    }

    if (postId !== undefined) {
      if (typeof postId !== "number") {
        return NextResponse.json(
          { error: "postId must be a number" },
          { status: 400 }
        );
      }

      const post = await prisma.post.findFirst({
        where: {
          id: postId,
          isHidden: false,
          isDeleted: false,
        },
        select: {
          id: true,
          content: true,
        },
      });

      if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }

      const translated = await translateLongText(post.content);

      return NextResponse.json({
        sourceType: "post",
        sourceId: post.id,
        original: post.content,
        translated,
      });
    }

    if (typeof threadId !== "number") {
      return NextResponse.json(
        { error: "threadId must be a number" },
        { status: 400 }
      );
    }

    const thread = await prisma.thread.findFirst({
      where: {
        id: threadId,
        isHidden: false,
      },
      select: {
        id: true,
        title: true,
        body: true,
        poll: {
          select: {
            question: true,
            options: {
              select: {
                text: true,
              },
              orderBy: {
                id: "asc",
              },
            },
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if ([thread.title, thread.body].filter(Boolean).join("").trim().length === 0) {
      return NextResponse.json(
        { error: "Thread text cannot be empty" },
        { status: 400 }
      );
    }

    const translatedTitle = thread.title.trim()
      ? await translateLongText(thread.title)
      : "";
    const translatedBody = thread.body.trim()
      ? await translateLongText(thread.body)
      : "";
    const originalPollQuestion = thread.poll?.question ?? "";
    const originalPollOptions = thread.poll?.options.map((option) => option.text) ?? [];
    const translatedPollQuestion = originalPollQuestion.trim()
      ? await translateLongText(originalPollQuestion)
      : "";
    const translatedPollOptions = await Promise.all(
      originalPollOptions.map((option) =>
        option.trim() ? translateLongText(option) : Promise.resolve("")
      )
    );
    const translated = [translatedTitle, translatedBody].filter(Boolean).join("\n\n");
    const original = [thread.title, thread.body].filter(Boolean).join("\n\n");

    return NextResponse.json({
      sourceType: "thread",
      sourceId: thread.id,
      original,
      translated,
      originalTitle: thread.title,
      originalBody: thread.body,
      translatedTitle,
      translatedBody,
      originalPollQuestion,
      originalPollOptions,
      translatedPollQuestion,
      translatedPollOptions,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
