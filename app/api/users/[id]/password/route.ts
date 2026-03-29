import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { comparePassword, hashPassword } from "@/lib/auth";
import { parseJsonBody } from "@/lib/requestBody";

const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_NUMBER = /\d/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = Number(id);

    if (!id || Number.isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { body, error: bodyError } = await parseJsonBody<{
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    }>(request);
    if (bodyError) return bodyError;

    const { currentPassword, newPassword, confirmPassword } = body ?? {};

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      typeof confirmPassword !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "currentPassword, newPassword, and confirmPassword are required.",
        },
        { status: 400 }
      );
    }

    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8 || newPassword.length > 100) {
      return NextResponse.json(
        { error: "New password must be between 8 and 100 characters." },
        { status: 400 }
      );
    }

    if (
      !PASSWORD_HAS_LETTER.test(newPassword) ||
      !PASSWORD_HAS_NUMBER.test(newPassword)
    ) {
      return NextResponse.json(
        { error: "New password must include at least one letter and one number." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "New password and confirmation do not match." },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from current password." },
        { status: 400 }
      );
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const validCurrentPassword = await comparePassword(
      currentPassword,
      currentUser.passwordHash
    );

    if (!validCurrentPassword) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 401 }
      );
    }

    const nextPasswordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: nextPasswordHash },
      select: { id: true },
    });

    return NextResponse.json(
      { message: "Password updated successfully." },
      { status: 200 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
