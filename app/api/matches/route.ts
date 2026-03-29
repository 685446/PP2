import { MatchStatus, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getLeagueCode } from "@/lib/sportsApi";
import { syncMatchesFromProvider, syncTeamsFromProvider } from "@/lib/sportsSync";
import { normalizeSeasonFilter } from "@/lib/seasonFilter";
import {
  getMatchesFreshness,
  getTeamsFreshness,
  runSyncWithLock,
} from "@/lib/syncFreshness";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";

type MatchFilters = Record<string, string>;
type TeamAliasSource = {
  name: string;
  shortName: string;
};

const ALLOWED_MATCH_STATUSES = new Set<MatchStatus>([
  "SCHEDULED",
  "TIMED",
  "IN_PLAY",
  "PAUSED",
  "FINISHED",
  "SUSPENDED",
  "POSTPONED",
  "CANCELLED",
  "AWARDED",
]);

// Normalizes team names for user-friendly matching:
// e.g., "Manchester City", "manchester-city", and "MAN CITY" all map cleanly.
function normalizeTeamQueryValue(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Lets "arsenal" match "Arsenal FC", "Sunderland AFC", etc.
function removeClubSuffix(value: string) {
  return value.replace(/(afc|fc|cf)$/g, "");
}

// Builds all normalized aliases we accept for a team row.
function buildTeamAliases(team: TeamAliasSource) {
  const aliases = new Set<string>();
  const candidates = [team?.name, team?.shortName];

  for (const candidate of candidates) {
    const normalized = normalizeTeamQueryValue(candidate);
    if (!normalized) continue;
    aliases.add(normalized);
    aliases.add(removeClubSuffix(normalized));
  }

  return aliases;
}

// Resolves optional team filters into one local teamId.
// Supported inputs:
// - teamId=1 (strict ID lookup)
// - team=arsenal (name/shortName lookup)
// If both are provided and conflict, we return a validation error.
async function resolveTeamIdFromFilters(filters: MatchFilters, errors: string[]) {
  let resolvedFromTeamId = null;
  let resolvedFromTeamName = null;

  if (filters.teamId) {
    const parsedTeamId = Number.parseInt(filters.teamId, 10);
    if (!Number.isInteger(parsedTeamId) || parsedTeamId <= 0) {
      errors.push("teamId must be a positive integer");
    } else {
      const teamRow = await prisma.team.findUnique({
        where: { id: parsedTeamId },
        select: { id: true },
      });
      if (!teamRow) {
        errors.push("teamId does not exist");
      } else {
        resolvedFromTeamId = parsedTeamId;
      }
    }
  }

  if (filters.team) {
    const normalizedQuery = normalizeTeamQueryValue(filters.team);
    if (!normalizedQuery) {
      errors.push("team must be a non-empty string");
    } else {
      const queryVariants = new Set([
        normalizedQuery,
        removeClubSuffix(normalizedQuery),
      ]);
      const teams = await prisma.team.findMany({
        select: { id: true, name: true, shortName: true },
      });

      const matches = teams.filter((team) => {
        const aliases = buildTeamAliases(team);
        for (const variant of queryVariants) {
          if (aliases.has(variant)) {
            return true;
          }
        }
        return false;
      });

      if (matches.length === 0) {
        errors.push(`Unknown team value: "${filters.team}"`);
      } else if (matches.length > 1) {
        errors.push(`Ambiguous team value: "${filters.team}"`);
      } else {
        resolvedFromTeamName = matches[0].id;
      }
    }
  }

  if (
    resolvedFromTeamId &&
    resolvedFromTeamName &&
    resolvedFromTeamId !== resolvedFromTeamName
  ) {
    errors.push("team and teamId refer to different teams");
    return null;
  }

  return resolvedFromTeamId || resolvedFromTeamName;
}

// Keeps a tight whitelist of supported query params.
function pickQueryParams(
  searchParams: Pick<URLSearchParams, "get">,
  keys: string[]
): MatchFilters {
  const picked: MatchFilters = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) {
      picked[key] = value;
    }
  }
  return picked;
}

// Converts validated query params into a Prisma where clause.
async function buildMatchesWhereClause(filters: MatchFilters) {
  const where: Prisma.MatchWhereInput = {};
  const errors: string[] = [];

  if (filters.season) {
    where.season = filters.season;
  }

  if (filters.matchday) {
    const parsedMatchday = Number.parseInt(filters.matchday, 10);
    if (Number.isInteger(parsedMatchday) && parsedMatchday > 0) {
      where.matchWeek = parsedMatchday;
    } else {
      errors.push("matchday must be a positive integer");
    }
  }

  if (filters.status) {
    const normalizedStatus = String(filters.status).toUpperCase() as MatchStatus;
    if (ALLOWED_MATCH_STATUSES.has(normalizedStatus)) {
      where.status = normalizedStatus;
    } else {
      errors.push(
        `status must be one of: ${Array.from(ALLOWED_MATCH_STATUSES).join(", ")}`
      );
    }
  }

  if (filters.dateFrom || filters.dateTo) {
    const utcDate: Prisma.DateTimeFilter = {};

    if (filters.dateFrom) {
      // Date parsing supports full ISO values and YYYY-MM-DD inputs.
      const from = new Date(filters.dateFrom);
      if (!Number.isNaN(from.getTime())) {
        utcDate.gte = from;
      } else {
        errors.push("dateFrom must be a valid date (YYYY-MM-DD)");
      }
    }

    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      if (!Number.isNaN(to.getTime())) {
        // Treat dateTo as inclusive end-of-day in UTC for date-only inputs.
        if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
          to.setUTCHours(23, 59, 59, 999);
        }
        utcDate.lte = to;
      } else {
        errors.push("dateTo must be a valid date (YYYY-MM-DD)");
      }
    }

    if (Object.keys(utcDate).length > 0) {
      where.utcDate = utcDate;
    }
  }

  const resolvedTeamId = await resolveTeamIdFromFilters(filters, errors);
  if (resolvedTeamId) {
    where.OR = [{ homeTeamId: resolvedTeamId }, { awayTeamId: resolvedTeamId }];
  }

  return { where, errors, resolvedTeamId };
}

// GET /api/matches
// Reads matches from local DB with optional filters.
// Auto-sync is only triggered when scoped matches are empty or stale.
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
    // Local route contract (includes local-only filters team/teamId).
    const rawFilters = pickQueryParams(url.searchParams, [
      "season",
      "matchday",
      "status",
      "dateFrom",
      "dateTo",
      "teamId",
      "team",
    ]);
    // Provider contract for sync calls (team/teamId are local only).
    const providerFilters = pickQueryParams(url.searchParams, [
      "season",
      "matchday",
      "status",
      "dateFrom",
      "dateTo",
    ]);
    const filters: MatchFilters = { ...rawFilters };

    // Accept both 2025 and 2025-26 from clients.
    // Internally we use DB season labels (YYYY-YY) and provider years (YYYY).
    const season = normalizeSeasonFilter(rawFilters.season);
    if (!season.ok) {
      return Response.json(
        { error: "Invalid query parameters", details: [season.error] },
        { status: 400 }
      );
    }

    if (season.dbSeason) {
      filters.season = season.dbSeason;
      providerFilters.season = season.providerSeason;
    } else {
      delete providerFilters.season;
    }

    const freshnessBefore = await getMatchesFreshness({ season: filters.season });
    let autoSynced = false;
    let syncReason = null;

    if (freshnessBefore.shouldSync) {
      // Matches require Team FK rows; ensure teams are available and not stale.
      const teamsFreshness = await getTeamsFreshness();
      if (teamsFreshness.shouldSync) {
        await runSyncWithLock("sync:teams", () => syncTeamsFromProvider());
      }

      const matchesKey = `sync:matches:${JSON.stringify(providerFilters)}`;
      await runSyncWithLock(matchesKey, () =>
        syncMatchesFromProvider(providerFilters)
      );
      autoSynced = true;
      syncReason = freshnessBefore.reason;
    }

    // Validate and build DB query only after any needed background refresh.
    const { where, errors, resolvedTeamId } = await buildMatchesWhereClause(filters);
    if (errors.length > 0) {
      return Response.json(
        { error: "Invalid query parameters", details: errors },
        { status: 400 }
      );
    }

    // Read from local DB after refresh/validation.
    const matches = await prisma.match.findMany({
      where,
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: { utcDate: "asc" },
    });
    const freshness = await getMatchesFreshness({ season: filters.season });

    return Response.json({
      league: getLeagueCode(),
      filters,
      resolvedTeamId,
      count: matches.length,
      autoSynced,
      syncReason,
      cache: freshness,
      data: matches,
    });
  } catch (error) {
    // 500 is returned for DB read/sync failures in this local-first endpoint.
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch matches" },
      { status: 500 }
    );
  }
}
