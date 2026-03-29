import { NextResponse } from "next/server";
import { syncTeamsFromProvider } from "@/lib/sportsSync";

// POST /api/sync/teams
// Fetches teams from the external provider and upserts them into local DB.
export async function POST() {
  try {
    // Returns sync stats: createdCount/updatedCount/skippedCount/sourceCount.
    const result = await syncTeamsFromProvider();
    return NextResponse.json(result);
  } catch (error) {
    // 502 indicates upstream/provider or sync-layer failure.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync teams" },
      { status: 502 }
    );
  }
}
