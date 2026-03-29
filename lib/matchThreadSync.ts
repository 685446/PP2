import { prisma } from "@/prisma/db";
import { hashPassword } from "@/lib/auth";
import {
  SYSTEM_USER_AVATAR,
  SYSTEM_USER_EMAIL,
  SYSTEM_USER_USERNAME,
} from "@/lib/systemUser";
const MATCH_THREAD_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

interface MatchForThread {
  id: number;
  utcDate: string | Date;
  venue?: string | null;
  homeTeam: { id: number; name: string; shortName: string };
  awayTeam: { id: number; name: string; shortName: string };
}

function buildMatchThreadTitle(match: MatchForThread): string {
  return `${match.homeTeam.shortName} vs ${match.awayTeam.shortName} - Match Thread`;
}

function formatKickoffUtc(utcDate: string | Date) {
  const kickoff = new Date(utcDate);
  if (Number.isNaN(kickoff.getTime())) {
    return "Unknown kickoff time";
  }

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
    hour12: false,
  }).format(kickoff);
}

function buildMatchThreadBody(match: MatchForThread): string {
  return [
    "This is an auto-generated match discussion thread.",
    `Fixture: ${match.homeTeam.name} vs ${match.awayTeam.name}`,
    `Kickoff (UTC): ${formatKickoffUtc(match.utcDate)}`,
    `Venue: ${match.venue || "Unknown venue"}`,
  ].join("\n");
}

function buildThreadWindow(kickoffDate: string | Date) {
  const kickoff = new Date(kickoffDate);
  return {
    openAt: new Date(kickoff.getTime() - MATCH_THREAD_WINDOW_DAYS * DAY_MS),
    closedAt: new Date(kickoff.getTime() + MATCH_THREAD_WINDOW_DAYS * DAY_MS),
  };
}

export async function getOrCreateMatchBotUser() {
  const passwordHash = await hashPassword(`system-${Date.now()}`);
  return prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {
      username: SYSTEM_USER_USERNAME,
      avatar: SYSTEM_USER_AVATAR,
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      email: SYSTEM_USER_EMAIL,
      username: SYSTEM_USER_USERNAME,
      passwordHash,
      avatar: SYSTEM_USER_AVATAR,
      role: "USER",
      status: "ACTIVE",
    },
    select: { id: true },
  });
}

export async function syncMatchThreadsForMatches(matches: MatchForThread[] = []) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return { sourceCount: 0, processedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0 };
  }

  const botUser = await getOrCreateMatchBotUser();
  const matchIds = matches.map((match) => match.id);

  const existingThreads = await prisma.thread.findMany({
    where: { matchId: { in: matchIds } },
    select: { matchId: true },
  });
  const existingMatchIds = new Set(existingThreads.map((thread: { matchId: number | null }) => thread.matchId));

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const match of matches) {
    if (!match?.id || !match?.homeTeam || !match?.awayTeam || !match?.utcDate) {
      skippedCount += 1;
      continue;
    }

    const { openAt, closedAt } = buildThreadWindow(match.utcDate);
    const title = buildMatchThreadTitle(match);
    const body = buildMatchThreadBody(match);
    const alreadyExists = existingMatchIds.has(match.id);

    await prisma.thread.upsert({
      where: { matchId: match.id },
      create: { title, body, type: "MATCH", authorId: botUser.id, teamId: null, matchId: match.id, openAt, closedAt },
      update: { title, body, openAt, closedAt },
    });

    if (alreadyExists) { updatedCount += 1; } else { createdCount += 1; }
  }

  return { sourceCount: matches.length, processedCount: matches.length, createdCount, updatedCount, skippedCount };
}
