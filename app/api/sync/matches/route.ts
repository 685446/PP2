import { NextResponse, NextRequest } from "next/server";
import { normalizeSeasonFilter } from "@/lib/seasonFilter";
import { runSyncWithLock } from "@/lib/syncFreshness";
import { syncMatchesFromProvider, syncTeamsFromProvider } from "@/lib/sportsSync";

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

// POST /api/sync/matches
// Optional filters: season, matchday, status, dateFrom, dateTo
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawFilters = pickQueryParams(url.searchParams, [
      "season",
      "matchday",
      "status",
      "dateFrom",
      "dateTo",
    ]);
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

    // Ensure Team FK rows exist before syncing matches.
    await runSyncWithLock("sync:teams", () => syncTeamsFromProvider());

    const matchesKey = `sync:matches:${JSON.stringify(filters)}`;
    const result = await runSyncWithLock(matchesKey, () =>
      syncMatchesFromProvider(filters)
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync matches" },
      { status: 502 }
    );
  }
}
