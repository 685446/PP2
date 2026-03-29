import { NextResponse, NextRequest } from "next/server";
import { normalizeSeasonFilter } from "@/lib/seasonFilter";
import { runSyncWithLock } from "@/lib/syncFreshness";
import { syncStandingsFromProvider, syncTeamsFromProvider } from "@/lib/sportsSync";

function pickQueryParams(
  searchParams: Pick<URLSearchParams, "get">,
  keys: string[]
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) {
      picked[key] = value;
    }
  }
  return picked;
}

// POST /api/sync/standings
// Optional filters: season
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawFilters = pickQueryParams(url.searchParams, ["season"]);
    const filters: Record<string, string> = { ...rawFilters };

    // Accept both 2025 and 2025-26 for season input,
    // but provider requests always need the start year (e.g. 2025).
    const season = normalizeSeasonFilter(rawFilters.season);
    if (!season.ok) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: [season.error] },
        { status: 400 }
      );
    }
    if (season.providerSeason) {
      filters.season = season.providerSeason;
    }

    // Ensure Team FK rows exist before syncing standings.
    await runSyncWithLock("sync:teams", () => syncTeamsFromProvider());

    const standingsKey = `sync:standings:${filters.season || "all"}`;
    const result = await runSyncWithLock(standingsKey, () =>
      syncStandingsFromProvider(filters)
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync standings" },
      { status: 502 }
    );
  }
}
