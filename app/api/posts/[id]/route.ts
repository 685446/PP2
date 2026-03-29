import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { syncAutoModerationReport } from "@/lib/aiModeration";
import { parseJsonBody } from "@/lib/requestBody";

type UpdatePostRequestBody = {
  content?: unknown;
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Missing post id" }, 
        { status: 400 })
      ;
    }

    const postId = Number(id);
    if (Number.isNaN(postId)) {
      return NextResponse.json(
        { error: "Invalid post id" }, 
        { status: 400 }
      );
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    const post = await prisma.post.findFirst({
      where: { id: postId, isHidden: false, isDeleted: false },
    });

    if (!post) {
      return NextResponse.json(
        { error: "Post not found" }, 
        { status: 404 }
      );
    }

    if (post.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // check thread is still open
    const thread = await prisma.thread.findFirst({
      where: { id: post.threadId, isHidden: false },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const now = new Date();
    if (thread.closedAt && now > thread.closedAt) {
      return NextResponse.json({ error: "Thread is closed" }, { status: 403 });
    }

    const { body, error: bodyError } =
      await parseJsonBody<UpdatePostRequestBody>(request);
    if (bodyError) return bodyError;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { content } = body;

    if (content == undefined) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Content must be a string" }, 
        { status: 400 }
      );
    }

    if (content.trim().length < 1 || content.trim().length > 10000) {
      return NextResponse.json(
        { error: "Content must be between 1 and 10000 characters" },
        { status: 400 }
      );
    }

    if (content.trim() === post.content) {
      return NextResponse.json(post);
    }

    const [, updatedPost] = await prisma.$transaction([
      prisma.postEdit.create({
        data: {
          postId: post.id,
          content: post.content,
        },
      }),
      prisma.post.update({
        where: { id: postId },
        data: { content: content.trim() },
        include: {
          author: {
            select: { id: true, username: true, avatar: true },
          },
          edits: {
            orderBy: { editedAt: "desc" },
          },
        },
      }),
    ]);

    await syncAutoModerationReport({
      targetType: "POST",
      postId,
      text: content.trim(),
      contentType: post.parentId ? "reply" : "post",
      source: post.parentId ? "reply edit" : "post edit",
    });

    return NextResponse.json(updatedPost);

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
        { error: "Missing post id" }, 
        { status: 400 })
      ;
    }

    const postId = Number(id);
    if (Number.isNaN(postId)) {
      return NextResponse.json(
        { error: "Invalid post id" }, 
        { status: 400 }
      );
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post || post.isHidden || post.isDeleted) {
      return NextResponse.json(
        { error: "Post not found" }, 
        { status: 404 }
      );
    }

    if (post.authorId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    await prisma.post.update({
      where: { id: postId },
      data: { isDeleted: true }
    });

    return new NextResponse(null, { status: 204 })

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );    
  }
}
