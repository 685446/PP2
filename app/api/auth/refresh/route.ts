import { NextRequest, NextResponse } from "next/server";
import { generateAccessToken, verifyRefreshToken } from "@/lib/auth";
import { parseJsonBody } from "@/lib/requestBody";

type RefreshRequestBody = {
  refreshToken?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const { body, error: bodyError } = await parseJsonBody(request);
    if (bodyError) return bodyError;

    const { refreshToken } = (body ?? {}) as RefreshRequestBody;

    if (!refreshToken) {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    if (typeof refreshToken !== "string") {
      return NextResponse.json(
        { error: "Invalid refresh token format" },
        { status: 400 }
      );
    }

    // verify refresh token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired refresh token" },
        { status: 401 }
      );
    }

    const userId = payload.userId;
    const role = payload.role;
    if (typeof userId !== "number" || (role !== "USER" && role !== "ADMIN")) {
      return NextResponse.json(
        { error: "Invalid refresh token payload" },
        { status: 401 }
      );
    }

    // generate new access token
    const accessToken = generateAccessToken({
      userId,
      role,
    });

    return NextResponse.json({
      accessToken,
      expiresIn: Number(process.env.JWT_EXPIRES_IN_SECONDS),
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
