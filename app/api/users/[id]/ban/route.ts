import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";
import { parseJsonBody } from "@/lib/requestBody";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // can't ban yourself
    if (user.id === userId) {
      return NextResponse.json(
        { error: "You cannot ban yourself" },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // can't ban another admin
    if (target.role === "ADMIN") {
      return NextResponse.json(
        { error: "You cannot ban an admin" },
        { status: 403 }
      );
    }

    if (target.status === "BANNED") {
      return NextResponse.json(
        { error: "User is already banned" },
        { status: 409 }
      );
    }

    const { body, error: bodyError } = await parseJsonBody<{
      reason?: string;
      suspendedUntil?: string;
    }>(request);
    if (bodyError) return bodyError;

    const { reason, suspendedUntil } = body ?? {};

    if (
      !reason ||
      typeof reason !== "string" ||
      reason.trim().length === 0 ||
      reason.trim().length > 500
    ) {
      return NextResponse.json(
        { error: "Reason must be between 1 and 500 characters" },
        { status: 400 }
      );
    }

    // if suspendedUntil is provided it's a suspension, otherwise permanent ban
    let data: Prisma.UserUpdateInput;
    let moderationReason;
    if (suspendedUntil) {
      const suspendedUntilDate = new Date(suspendedUntil);
      if (isNaN(suspendedUntilDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid suspendedUntil date" },
          { status: 400 }
        );
      }
      if (suspendedUntilDate <= new Date()) {
        return NextResponse.json(
          { error: "suspendedUntil must be in the future" },
          { status: 400 }
        );
      }
      data = {
        status: "SUSPENDED",
        statusReason: reason?.trim() || "",
        suspendedUntil: suspendedUntilDate,
      };
      moderationReason = `Admin suspension: ${reason.trim()}`;
    } else {
      data = {
        status: "BANNED",
        statusReason: reason?.trim() || "",
        suspendedUntil: null,
      };
      moderationReason = `Admin ban: ${reason.trim()}`;
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          username: true,
          email: true,
          status: true,
          statusReason: true,
          suspendedUntil: true,
        },
      });

      const relatedReports = await tx.report.updateMany({
        where: {
          status: "PENDING",
          targetType: "USER",
          reportedUserId: userId,
        },
        data: {
          status: "APPROVED",
        },
      });

      await tx.report.create({
        data: {
          reporterId: user.id,
          targetType: "USER",
          reportedUserId: userId,
          reason: moderationReason,
          status: "APPROVED",
        },
      });

      return {
        ...updatedUser,
        resolvedRelatedReportsCount: relatedReports.count,
      };
    });

    const actionTaken =
      updated.status === "SUSPENDED"
        ? updated.resolvedRelatedReportsCount > 0
          ? `Account suspended and ${updated.resolvedRelatedReportsCount} related user report${
              updated.resolvedRelatedReportsCount === 1 ? "" : "s"
            } approved.`
          : "Account suspended and moderation history saved."
        : updated.resolvedRelatedReportsCount > 0
          ? `Account banned and ${updated.resolvedRelatedReportsCount} related user report${
              updated.resolvedRelatedReportsCount === 1 ? "" : "s"
            } approved.`
          : "Account banned and moderation history saved.";

    return NextResponse.json({
      ...updated,
      actionTaken,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
