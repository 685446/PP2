import { NextRequest, NextResponse } from "next/server";

export async function parseJsonBody<T = unknown>(
  request: NextRequest
): Promise<{ body: T | null; error: NextResponse | null }> {
  try {
    const body = (await request.json()) as T;
    return { body, error: null };
  } catch {
    return {
      body: null,
      error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}
