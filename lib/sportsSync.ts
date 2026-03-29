import { MatchStatus } from "@prisma/client";
import { prisma } from "@/prisma/db";
import { buildCompetitionPath, getLeagueCode, sportsFetch } from "@/lib/sportsApi";
import { syncMatchThreadsForMatches } from "@/lib/matchThreadSync";
import { warmTeamPaletteCache } from "@/lib/teamPalette";

type ProviderTeam = Record<string, unknown>;
type ProviderMatch = Record<string, unknown>;
type ProviderRow = Record<string, unknown>;
type ProviderSeason = { startDate?: string; endDate?: string; id?: number } | null;
type ResolvedTeam = { id: number; externalId: string; venue: string };

const MATCH_STATUS_MAP: Record<string, MatchStatus> = {
  SCHEDULED: "SCHEDULED",
  TIMED: "TIMED",
  IN_PLAY: "IN_PLAY",
  LIVE: "IN_PLAY",
  PAUSED: "PAUSED",
  HALF_TIME: "PAUSED",
  EXTRA_TIME: "IN_PLAY",
  PENALTY_SHOOTOUT: "IN_PLAY",
  FINISHED: "FINISHED",
  SUSPENDED: "SUSPENDED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
  AWARDED: "AWARDED",
};

function normalizeTeam(team: ProviderTeam) {
  const externalId = team?.id;
  const name = typeof team?.name === "string" ? team.name.trim() : "";
  if (!externalId || !name) return null;

  const shortName =
    (typeof team.shortName === "string" && team.shortName.trim()) ||
    (typeof team.tla === "string" && team.tla.trim()) ||
    name;

  return {
    externalId: String(externalId),
    name,
    shortName,
    crestUrl: typeof team.crest === "string" ? team.crest : null,
    venue: typeof team.venue === "string" && team.venue.trim() ? team.venue.trim() : "Unknown venue",
  };
}

export async function syncTeamsFromProvider() {
  const payload = await sportsFetch(buildCompetitionPath("teams"), { revalidate: 0 });
  const sourceTeams: ProviderTeam[] = Array.isArray(payload?.teams) ? payload.teams : [];
  const normalized = sourceTeams.map(normalizeTeam).filter(Boolean) as NonNullable<ReturnType<typeof normalizeTeam>>[];
  const externalIds = normalized.map((team) => team.externalId);

  if (externalIds.length === 0) {
    return { league: getLeagueCode(), sourceCount: sourceTeams.length, processedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: sourceTeams.length, syncedAt: new Date().toISOString() };
  }

  const existing = await prisma.team.findMany({ where: { externalId: { in: externalIds } }, select: { externalId: true } });
  const existingIds = new Set(existing.map((team: { externalId: string }) => team.externalId));  let createdCount = 0;
  let updatedCount = 0;

  for (const team of normalized) {
    const alreadyExists = existingIds.has(team.externalId);
    await prisma.team.upsert({
      where: { externalId: team.externalId },
      create: team,
      update: { name: team.name, shortName: team.shortName, crestUrl: team.crestUrl, venue: team.venue },
    });
    if (alreadyExists) { updatedCount += 1; } else { createdCount += 1; }
  }

  // Best-effort warmup so promoted/new clubs have colors ready without schema changes.
  await warmTeamPaletteCache(
    normalized.map((team) => ({
      externalId: team.externalId,
      name: team.name,
      crestUrl: team.crestUrl,
    }))
  );

  return { league: getLeagueCode(), sourceCount: sourceTeams.length, processedCount: normalized.length, createdCount, updatedCount, skippedCount: sourceTeams.length - normalized.length, syncedAt: new Date().toISOString() };
}

function toSeasonLabel(season: ProviderSeason, utcDate: string): string {
  const startDate = typeof season?.startDate === "string" ? season.startDate : null;
  const endDate = typeof season?.endDate === "string" ? season.endDate : null;

  if (startDate && endDate) {
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(2, 4));
    if (!Number.isNaN(startYear) && !Number.isNaN(endYear)) {
      return `${startYear}-${String(endYear).padStart(2, "0")}`;
    }
  }

  if (typeof season?.id === "number") return String(season.id);

  const kickoffYear = Number(utcDate.slice(0, 4));
  return Number.isNaN(kickoffYear) ? "unknown" : String(kickoffYear);
}

function normalizeMatch(match: ProviderMatch) {
  const externalId = match?.id;
  const homeExternalId = (match?.homeTeam as Record<string, unknown>)?.id;
  const awayExternalId = (match?.awayTeam as Record<string, unknown>)?.id;
  const utcDate = typeof match?.utcDate === "string" ? match.utcDate : "";

  if (!externalId || !homeExternalId || !awayExternalId || !utcDate) return null;

  const kickoff = new Date(utcDate);
  if (Number.isNaN(kickoff.getTime())) return null;

  const matchWeekRaw = Number(match?.matchday);
  const matchWeek = Number.isInteger(matchWeekRaw) && matchWeekRaw > 0 ? matchWeekRaw : 0;
  const providerStatus = typeof match?.status === "string" ? match.status : "";

  return {
    externalId: String(externalId),
    homeExternalId: String(homeExternalId),
    awayExternalId: String(awayExternalId),
    matchWeek,
    season: toSeasonLabel(match?.season as ProviderSeason, utcDate),
    utcDate: kickoff,
    status: MATCH_STATUS_MAP[providerStatus] || "SCHEDULED",
    venue: typeof match?.venue === "string" && match.venue.trim() ? match.venue.trim() : "Unknown venue",
    homeScore: typeof (match?.score as Record<string, unknown>)?.fullTime === "object" && typeof ((match?.score as Record<string, unknown>)?.fullTime as Record<string, unknown>)?.home === "number" ? ((match?.score as Record<string, unknown>)?.fullTime as Record<string, unknown>)?.home as number : null,
    awayScore: typeof (match?.score as Record<string, unknown>)?.fullTime === "object" && typeof ((match?.score as Record<string, unknown>)?.fullTime as Record<string, unknown>)?.away === "number" ? ((match?.score as Record<string, unknown>)?.fullTime as Record<string, unknown>)?.away as number : null,
  };
}

export async function syncMatchesFromProvider(query: Record<string, string | number | undefined> = {}) {
  const payload = await sportsFetch(buildCompetitionPath("matches", query), { revalidate: 0 });
  const sourceMatches: ProviderMatch[] = Array.isArray(payload?.matches) ? payload.matches : [];
  const normalized = sourceMatches.map(normalizeMatch).filter(Boolean) as NonNullable<ReturnType<typeof normalizeMatch>>[];

  if (normalized.length === 0) {
    return { league: getLeagueCode(), filters: query, sourceCount: sourceMatches.length, processedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: sourceMatches.length, matchThreadSync: { sourceCount: 0, processedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0 }, syncedAt: new Date().toISOString() };
  }

  const teamExternalIds = new Set<string>();
  for (const match of normalized) {
    teamExternalIds.add(match.homeExternalId);
    teamExternalIds.add(match.awayExternalId);
  }

  const teams = await prisma.team.findMany({
    where: { externalId: { in: Array.from(teamExternalIds) } },
    select: { id: true, externalId: true, venue: true },
  });
  const teamByExternalId = new Map<string, ResolvedTeam>(
    teams.map((team: ResolvedTeam) => [team.externalId, team])
  );
  
  const existing = await prisma.match.findMany({ where: { externalId: { in: normalized.map((match) => match.externalId) } }, select: { externalId: true } });
  const existingIds = new Set(existing.map((match: { externalId: string }) => match.externalId));

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const syncedMatchIds: number[] = [];

  for (const match of normalized) {
    const homeTeam = teamByExternalId.get(match.homeExternalId);
    const awayTeam = teamByExternalId.get(match.awayExternalId);
    const homeTeamId = homeTeam?.id;
    const awayTeamId = awayTeam?.id;
    if (!homeTeamId || !awayTeamId) { skippedCount += 1; continue; }

    const resolvedVenue =
      match.venue && match.venue !== "Unknown venue"
        ? match.venue
        : homeTeam?.venue || awayTeam?.venue || "Unknown venue";

    const alreadyExists = existingIds.has(match.externalId);
    const persisted = await prisma.match.upsert({
      where: { externalId: match.externalId },
      create: { externalId: match.externalId, homeTeamId, awayTeamId, matchWeek: match.matchWeek, season: match.season, utcDate: match.utcDate, status: match.status, venue: resolvedVenue, homeScore: match.homeScore, awayScore: match.awayScore },
      update: { homeTeamId, awayTeamId, matchWeek: match.matchWeek, season: match.season, utcDate: match.utcDate, status: match.status, venue: resolvedVenue, homeScore: match.homeScore, awayScore: match.awayScore },
    });
    syncedMatchIds.push(persisted.id);
    if (alreadyExists) { updatedCount += 1; } else { createdCount += 1; }
  }

  const syncedMatchesForThreads = await prisma.match.findMany({
    where: { id: { in: syncedMatchIds } },
    include: { homeTeam: { select: { id: true, name: true, shortName: true } }, awayTeam: { select: { id: true, name: true, shortName: true } } },
  });
  const matchThreadSync = await syncMatchThreadsForMatches(syncedMatchesForThreads);

  return { league: getLeagueCode(), filters: query, sourceCount: sourceMatches.length, processedCount: normalized.length, createdCount, updatedCount, skippedCount: skippedCount + (sourceMatches.length - normalized.length), matchThreadSync, syncedAt: new Date().toISOString() };
}

function extractTotalStandingsRows(payload: Record<string, unknown>) {
  const standingsGroups: ProviderRow[] = Array.isArray(payload?.standings) ? payload.standings : [];
  const totalGroup = standingsGroups.find((group) => group?.type === "TOTAL" && Array.isArray(group?.table)) || standingsGroups.find((group) => Array.isArray(group?.table));
  return Array.isArray(totalGroup?.table) ? totalGroup.table as ProviderRow[] : [];
}

function normalizeStandingRow(row: ProviderRow, seasonLabel: string) {
  const teamExternalId = (row?.team as Record<string, unknown>)?.id;
  if (!teamExternalId || !seasonLabel) return null;

  const position = Number(row?.position);
  const playedGames = Number(row?.playedGames);
  const won = Number(row?.won);
  const draw = Number(row?.draw);
  const lost = Number(row?.lost);
  const points = Number(row?.points);
  const goalDifferenceRaw = Number(row?.goalDifference);
  const goalsFor = Number(row?.goalsFor);
  const goalsAgainst = Number(row?.goalsAgainst);
  const goalDifference = Number.isInteger(goalDifferenceRaw) ? goalDifferenceRaw : (Number.isInteger(goalsFor) && Number.isInteger(goalsAgainst) ? goalsFor - goalsAgainst : 0);

  if (!Number.isInteger(position) || !Number.isInteger(playedGames) || !Number.isInteger(won) || !Number.isInteger(draw) || !Number.isInteger(lost) || !Number.isInteger(points)) return null;

  return { teamExternalId: String(teamExternalId), season: seasonLabel, position, playedGames, won, draw, lost, points, goalDifference };
}

export async function syncStandingsFromProvider(query: Record<string, string | number | undefined> = {}) {
  const payload = await sportsFetch(buildCompetitionPath("standings", query), { revalidate: 0 });
  const sourceRows = extractTotalStandingsRows(payload);
  const seasonLabel = toSeasonLabel(payload?.season as ProviderSeason, typeof payload?.season?.startDate === "string" ? payload.season.startDate : new Date().toISOString());

  const normalized = sourceRows.map((row) => normalizeStandingRow(row, seasonLabel)).filter(Boolean) as NonNullable<ReturnType<typeof normalizeStandingRow>>[];

  if (normalized.length === 0) {
    return { league: getLeagueCode(), filters: query, season: seasonLabel, sourceCount: sourceRows.length, processedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: sourceRows.length, syncedAt: new Date().toISOString() };
  }

  const teamExternalIds = Array.from(new Set(normalized.map((standing) => standing.teamExternalId)));
  const teams = await prisma.team.findMany({ where: { externalId: { in: teamExternalIds } }, select: { id: true, externalId: true } });
  const teamIdByExternalId = new Map(teams.map((team: { externalId: string; id: number }) => [team.externalId, team.id]));

  const resolvedRows: (NonNullable<ReturnType<typeof normalizeStandingRow>> & { teamId: number })[] = [];
  let skippedCount = sourceRows.length - normalized.length;

  for (const row of normalized) {
    const teamId = teamIdByExternalId.get(row.teamExternalId);
    if (!teamId) { skippedCount += 1; continue; }
    resolvedRows.push({ ...row, teamId });
  }

  if (resolvedRows.length === 0) {
    return { league: getLeagueCode(), filters: query, season: seasonLabel, sourceCount: sourceRows.length, processedCount: normalized.length, createdCount: 0, updatedCount: 0, skippedCount, syncedAt: new Date().toISOString() };
  }

  const existing = await prisma.standing.findMany({ where: { season: seasonLabel, teamId: { in: resolvedRows.map((row) => row.teamId) } }, select: { teamId: true, season: true } });
  const existingKeys = new Set(existing.map((row: { teamId: number; season: string }) => `${row.teamId}:${row.season}`));

  let createdCount = 0;
  let updatedCount = 0;

  for (const row of resolvedRows) {
    const key = `${row.teamId}:${row.season}`;
    const alreadyExists = existingKeys.has(key);
    await prisma.standing.upsert({
      where: { teamId_season: { teamId: row.teamId, season: row.season } },
      create: { teamId: row.teamId, season: row.season, position: row.position, playedGames: row.playedGames, won: row.won, draw: row.draw, lost: row.lost, points: row.points, goalDifference: row.goalDifference },
      update: { position: row.position, playedGames: row.playedGames, won: row.won, draw: row.draw, lost: row.lost, points: row.points, goalDifference: row.goalDifference },
    });
    if (alreadyExists) { updatedCount += 1; } else { createdCount += 1; }
  }

  return { league: getLeagueCode(), filters: query, season: seasonLabel, sourceCount: sourceRows.length, processedCount: normalized.length, createdCount, updatedCount, skippedCount, syncedAt: new Date().toISOString() };
}
