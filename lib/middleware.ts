import { NextResponse, NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { prisma } from "@/prisma/db";

export async function authenticate(request: NextRequest, { allowRestricted = false } = {}) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.split(" ")[1]?.trim();
  const payload = verifyAccessToken(token);

  if (!payload) {
    return { error: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, status: true, suspendedUntil: true },
  });

  if (!user) {
    return { error: NextResponse.json({ error: "User not found" }, { status: 401 }) };
  }

  if (!allowRestricted) {
    if (user.status === "BANNED") {
      return { error: NextResponse.json({ error: "Account banned" }, { status: 403 }) };
    }
    if (user.status === "SUSPENDED" && user.suspendedUntil && user.suspendedUntil > new Date()) {
      return { error: NextResponse.json({ error: "Account suspended" }, { status: 403 }) };
    }
  }

  return { user };
}