import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@/lib/middleware";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function extensionFromType(mimeType: string, fallbackName = "") {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";

  const inferred = path.extname(fallbackName).replace(".", "").toLowerCase();
  return inferred || "png";
}

// POST /api/users/:id/avatar-upload
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    const userId = Number(id);
    if (Number.isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const avatarFile = formData.get("avatar");

    if (!(avatarFile instanceof File)) {
      return NextResponse.json(
        { error: "Avatar file is required" },
        { status: 400 }
      );
    }

    if (!avatarFile.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Avatar must be an image file" },
        { status: 400 }
      );
    }

    if (avatarFile.size <= 0) {
      return NextResponse.json({ error: "Avatar cannot be empty" }, { status: 400 });
    }

    if (avatarFile.size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { error: "Avatar must be 2MB or smaller" },
        { status: 413 }
      );
    }

    const extension = extensionFromType(avatarFile.type, avatarFile.name);
    const fileName = `user-${userId}-${Date.now()}-${randomUUID()}.${extension}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");
    const fullPath = path.join(uploadDir, fileName);

    const bytes = Buffer.from(await avatarFile.arrayBuffer());

    await mkdir(uploadDir, { recursive: true });
    await writeFile(fullPath, bytes);

    return NextResponse.json({
      avatar: `/uploads/avatars/${fileName}`,
      fileName,
      size: avatarFile.size,
      mimeType: avatarFile.type,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
