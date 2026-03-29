import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Missing appeal id" }, { status: 400 });
    }

    const appealId = Number(id);
    if (Number.isNaN(appealId)) {
      return NextResponse.json({ error: "Invalid appeal id" }, { status: 400 });
    }

    const { user, error } = await authenticate(request);
    if (error) return error;

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const appeal = await prisma.appeal.findUnique({
      where: { id: appealId },
    });

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 });
    }

    if (appeal.status !== "PENDING") {
      return NextResponse.json(
        { error: "Appeal has already been resolved" },
        { status: 409 }
      );
    }

    const updated = await prisma.appeal.update({
      where: { id: appealId },
      data: { status: "REJECTED" },
    });

    return NextResponse.json(updated);

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
