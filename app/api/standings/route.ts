import { NextRequest, NextResponse } from "next/server";
import { getLeagueCode } from "@/lib/sportsApi";
import {
  syncStandingsFromProvider,
  syncTeamsFromProvider,
} from "@/lib/sportsSync";
import { normalizeSeasonFilter } from "@/lib/seasonFilter";
import {
  getStandingsFreshness,
  getTeamsFreshness,
  runSyncWithLock,
} from "@/lib/syncFreshness";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";

// Keeps a tight whitelist of supported query params.
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

// GET /api/standings
// Reads standings from local DB, with optional season filter.
// Auto-sync is only triggered when scoped standings are empty or stale.
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

    const url = new URL(request.url);
    const rawFilters = pickQueryParams(url.searchParams, ["season"]);
    const filters: Record<string, string> = { ...rawFilters };

    // Accept both 2025 and 2025-26 from clients.
    // Internally we use DB season labels (YYYY-YY) and provider years (YYYY).
    const season = normalizeSeasonFilter(rawFilters.season);
    if (!season.ok) {
      return Response.json(
        { error: "Invalid query parameters", details: [season.error] },
        { status: 400 }
      );
    }

    const providerFilters: Record<string, string> = {};
    if (season.dbSeason) {
      filters.season = season.dbSeason;
      providerFilters.season = season.providerSeason;
    }

    const freshnessBefore = await getStandingsFreshness(filters);
    let autoSynced = false;
    let syncReason = null;

    if (freshnessBefore.shouldSync) {
      // Standings depend on Team FK rows, so keep teams in sync first.
      const teamsFreshness = await getTeamsFreshness();
      if (teamsFreshness.shouldSync) {
        await runSyncWithLock("sync:teams", () => syncTeamsFromProvider());
      }

      // Season-scoped lock avoids duplicate standings sync for same season.
      const standingsKey = `sync:standings:${filters.season || "all"}`;
      await runSyncWithLock(standingsKey, () =>
        syncStandingsFromProvider(providerFilters)
      );
      autoSynced = true;
      syncReason = freshnessBefore.reason;
    }

    // Read from local DB after any required refresh.
    const where = filters.season ? { season: filters.season } : {};
    const standings = await prisma.standing.findMany({
      where,
      include: { team: true },
      orderBy: [{ season: "desc" }, { position: "asc" }],
    });
    const freshness = await getStandingsFreshness(filters);

    return Response.json({
      league: getLeagueCode(),
      filters,
      count: standings.length,
      autoSynced,
      syncReason,
      cache: freshness,
      data: standings,
    });
  } catch (error) {
    // 500 is returned for DB read/sync failures in this local-first endpoint.
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch standings" },
      { status: 500 }
    );
  }
}
