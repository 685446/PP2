import { NextRequest, NextResponse } from "next/server";
import { getLeagueCode } from "@/lib/sportsApi";
import { syncTeamsFromProvider } from "@/lib/sportsSync";
import { getTeamsFreshness, runSyncWithLock } from "@/lib/syncFreshness";
import { verifyAccessToken } from "@/lib/auth";
import { prisma } from "@/prisma/db";

// GET /api/teams
// Reads teams from local DB and refreshes only when table is empty or stale.
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1];
      if (!verifyAccessToken(token)) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
    }
        
    // Freshness is based on latest Team.updatedAt and TTL from syncFreshness.js.
    const freshnessBefore = await getTeamsFreshness();
    let autoSynced = false;
    let syncReason = null;

    if (freshnessBefore.shouldSync) {
      // Lock avoids duplicate provider calls when multiple requests arrive together.
      await runSyncWithLock("sync:teams", () => syncTeamsFromProvider());
      autoSynced = true;
      syncReason = freshnessBefore.reason;
    }

    // Always return DB rows (local-first read route).
    const teams = await prisma.team.findMany({
      orderBy: { name: "asc" },
    });
    const freshness = await getTeamsFreshness();

    return Response.json({
      league: getLeagueCode(),
      count: teams.length,
      autoSynced,
      syncReason,
      cache: freshness,
      data: teams,
    });
  } catch (error) {
    console.error("Failed to fetch teams:", error);
    // 500 is returned for DB read/sync failures in this local-first endpoint.
    return Response.json(
      { error: "Failed to fetch teams" },
      { status: 500 }
    );
  }
}
