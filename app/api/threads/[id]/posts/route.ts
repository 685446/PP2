import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { verifyAccessToken } from "@/lib/auth";
import { syncAutoModerationReport } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";

type CreatePostRequestBody = {
  content?: unknown;
  parentId?: unknown;
};

type ThreadPost = Prisma.PostGetPayload<{
  include: {
    author: {
      select: { id: true; username: true; avatar: true };
    };
    edits: true;
    _count: {
      select: { replies: true };
    };
  };
}>;

type ThreadPostNode = Omit<ThreadPost, "author"> & {
  author: ThreadPost["author"] | null;
  content: string;
  replies: ThreadPostNode[];
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

    // check thread is open
    const now = new Date();
    if (now < thread.openAt) {
      return NextResponse.json({ error: "Thread is not open yet" }, { status: 403 });
    }
    if (thread.closedAt && now > thread.closedAt) {
      return NextResponse.json({ error: "Thread is closed" }, { status: 403 });
    }

    const { body, error: bodyError } =
      await parseJsonBody<CreatePostRequestBody>(request);
    if (bodyError) return bodyError;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { content, parentId } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    if (content.trim().length < 1 || content.trim().length > 10000) {
      return NextResponse.json(
        { error: "Content must be between 1 and 10000 characters" },
        { status: 400 }
      );
    }

    if (parentId !== undefined && parentId !== null) {
      if (typeof parentId !== "number") {
        return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
      }

      const parentPost = await prisma.post.findFirst({
        where: { id: parentId, threadId, isHidden: false, isDeleted: false },
      });

      if (!parentPost) {
        return NextResponse.json({ error: "Parent post not found" }, { status: 404 });
      }
    }

    const post = await prisma.post.create({
      data: {
        content: content.trim(),
        authorId: user.id,
        threadId,
        parentId: parentId ?? null,
      },
      include: {
        author: {
          select: { id: true, username: true, avatar: true },
        },
      }
    });

    await syncAutoModerationReport({
      targetType: "POST",
      postId: post.id,
      text: post.content,
      contentType: parentId ? "reply" : "post",
      source: parentId ? "reply create" : "post create",
    });

    return NextResponse.json(post, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    );
  }
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

      const token = authHeader.split(" ")[1]?.trim();
      if (!token || !verifyAccessToken(token)) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
    }

    const threadId = Number(id);
    if (Number.isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
    }

    // check thread exists
    const thread = await prisma.thread.findFirst({
      where: { id: threadId, isHidden: false },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;
    const rootPostIdParam = searchParams.get("rootPostId");
    const rootPostId = rootPostIdParam ? Number(rootPostIdParam) : null;

    if (rootPostIdParam && (rootPostId === null || Number.isNaN(rootPostId))) {
      return NextResponse.json({ error: "Invalid rootPostId" }, { status: 400 });
    }

    const topLevelPostsPromise: Promise<Array<{ id: number }>> = rootPostId
      ? Promise.resolve([])
      : prisma.post.findMany({
          where: { threadId, parentId: null, isHidden: false },
          skip,
          take: limit,
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

    const totalPromise: Promise<number> = rootPostId
      ? Promise.resolve(1)
      : prisma.post.count({
          where: { threadId, parentId: null, isHidden: false },
        });

    const [topLevelPosts, allPosts, total] = await Promise.all([
      topLevelPostsPromise,
      prisma.post.findMany({
        where: { threadId, isHidden: false },
        orderBy: { createdAt: "asc" },
        include: {
          author: {
            select: { id: true, username: true, avatar: true },
          },
          edits: {
            orderBy: { editedAt: "desc" },
          },
          _count: {
            select: { replies: true },
          },
        },
      }),
      totalPromise,
    ]);

    const topLevelIds = new Set(topLevelPosts.map((post) => post.id));
    const replyMap = new Map<number, ThreadPost[]>();

    for (const post of allPosts) {
      if (!post.parentId) continue;
      if (!replyMap.has(post.parentId)) {
        replyMap.set(post.parentId, []);
      }
      replyMap.get(post.parentId)?.push(post);
    }

    const buildNode = (post: ThreadPost): ThreadPostNode => ({
      ...post,
      content: post.isDeleted ? "[deleted]" : post.content,
      author: post.isDeleted ? null : post.author,
      replies: (replyMap.get(post.id) || []).map(buildNode),
    });

    let transformed;

    if (rootPostId) {
      const rootPost = allPosts.find((post) => post.id === rootPostId);
      if (!rootPost) {
        return NextResponse.json({ error: "Root post not found" }, { status: 404 });
      }
      transformed = [buildNode(rootPost)];
    } else {
      transformed = allPosts
        .filter((post) => post.parentId === null && topLevelIds.has(post.id))
        .map(buildNode);
    }

    return NextResponse.json({
      posts: transformed,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      rootPostId,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
