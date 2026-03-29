import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { verifyAccessToken } from "@/lib/auth";
import { generateDigest } from "@/lib/aiModeration";
import { enforceDigestAbuseProtection } from "@/lib/digestAbuse";
import { getCacheJson, setCacheJson } from "@/lib/redisCache";

const DIGEST_FALLBACKS = {
  topDiscussions: "No new discussions.",
  recordedMatches: "No match updates.",
  standings: "No standings updates.",
};

const PROMPT_LEAK_MARKERS = [
  "use only the facts below",
  "return plain text only",
  "write exactly 1-2 concise sentences",
  "you are writing one section",
  "facts:",
  "section:",
  "newsquiz",
  "cnn.com",
];

const OVERLAP_STOP_WORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "have",
  "will",
  "were",
  "your",
  "daily",
  "digest",
  "section",
  "facts",
  "below",
  "only",
  "plain",
  "text",
  "write",
  "exactly",
  "concise",
  "sentences",
  "return",
  "point",
  "points",
  "top",
  "race",
  "line",
  "recent",
  "result",
  "results",
  "fans",
  "supporters",
  "discussion",
  "discussions",
  "recorded",
  "matches",
  "standings",
  "snapshot",
  "update",
]);

const DISCUSSION_TOPIC_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(experience|leadership|young squad|too young|veteran)/i, label: "the lack of experience and leadership in the squad" },
  { pattern: /(transfer|window|signing|recruit|rebuild|market)/i, label: "transfer plans and recruitment priorities" },
  { pattern: /(defen[cs]e|conced|clean sheet|back line|center-back|full-back)/i, label: "defensive structure and goals conceded" },
  { pattern: /(attack|finishing|striker|chance|xg|creative|midfield)/i, label: "attacking efficiency and chance creation" },
  { pattern: /(manager|coach|tactic|formation|lineup|selection|bench)/i, label: "manager decisions and tactical setup" },
  { pattern: /(injur|fitness|return|availability|suspension)/i, label: "injuries, player fitness, and squad availability" },
  { pattern: /(title|top 4|top-four|relegation|table|standings|race)/i, label: "the bigger table race implications for the season" },
];

const DIGEST_SHARED_TTL_MS = (() => {
  const raw = Number.parseInt(String(process.env.DIGEST_SHARED_TTL_MS || ""), 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 30 * 60 * 1000;
})();

const DIGEST_STALE_TTL_MS = Math.max(DIGEST_SHARED_TTL_MS * 4, 2 * 60 * 60 * 1000);
const DIGEST_SHARED_CACHE_KEY = "digest:shared:current";
const DIGEST_SHARED_STALE_CACHE_KEY = "digest:shared:stale";

type DigestThread = {
  title: string;
  body: string;
  _count: { posts: number };
  team: { name: string } | null;
};

type DigestMatch = {
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { name: string };
  awayTeam: { name: string };
};

type DigestStanding = {
  position: number;
  points: number;
  team: { name: string };
};

type StandingsBreakdown = {
  titleRace: string | null;
  topFour: string | null;
  relegation: string | null;
};

type DigestSectionResult = {
  text: string;
  usedAi: boolean;
  source: string;
};

type DigestPayload = {
  generatedAt: string;
  digest: string;
  digestSections: {
    topDiscussions: string;
    recordedMatches: string;
    standings: string;
    standingsBreakdown: {
      titleRace: string | null;
      topFourRace: string | null;
      relegationRace: string | null;
    };
  };
  digestMeta: {
    topDiscussionsSource: string;
    recordedMatchesSource: string;
    standingsSource: string;
    usedAiForAllSections: boolean;
    servedStale?: boolean;
  };
  data: {
    recentMatches: DigestMatch[];
    topThreads: DigestThread[];
    standings: DigestStanding[];
  };
};

let sharedDigestInFlight: Promise<DigestPayload> | null = null;

function cleanClubName(name: string) {
  return String(name || "")
    .replace(/\s+FC$/i, "")
    .replace(/\s+AFC$/i, "")
    .trim();
}

function normalizeAiText(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^\s*["']|["']\s*$/g, "")
    .trim();
}

function tokenizeForOverlap(text: string) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z][a-z0-9'-]{2,}/g) || [];
}

function hasUnexpectedNumbers(output: string, facts: string[]) {
  const outputNumbers = (output.match(/\d+/g) || []).sort();
  if (outputNumbers.length === 0) return false;

  const factNumbers = new Set((facts.join(" ").match(/\d+/g) || []).map((value) => value.trim()));
  return outputNumbers.some((value) => !factNumbers.has(value));
}

function hasFactOverlap(output: string, facts: string[]) {
  const outputTokens = new Set(
    tokenizeForOverlap(output).filter((token) => !OVERLAP_STOP_WORDS.has(token))
  );
  if (outputTokens.size === 0) return false;

  const factTokens = new Set(
    tokenizeForOverlap(facts.join(" ")).filter((token) => !OVERLAP_STOP_WORDS.has(token))
  );
  if (factTokens.size === 0) return false;

  let overlap = 0;
  for (const token of outputTokens) {
    if (factTokens.has(token)) overlap += 1;
  }

  return overlap >= 1;
}

function containsPromptLeakage(text: string) {
  const normalized = String(text || "").toLowerCase();
  return PROMPT_LEAK_MARKERS.some((marker) => normalized.includes(marker));
}

function inferDiscussionTopic(text: string) {
  const content = String(text || "").trim();
  for (const rule of DISCUSSION_TOPIC_RULES) {
    if (rule.pattern.test(content)) {
      return rule.label;
    }
  }
  return "recent performances and what should change next";
}

function buildTopDiscussionsDraft(threads: DigestThread[]) {
  if (!threads.length) {
    return DIGEST_FALLBACKS.topDiscussions;
  }

  const topItems = threads.slice(0, 2).map((thread) => {
    const communityLabel = thread.team?.name
      ? `${cleanClubName(thread.team.name)} fans`
      : "League fans";
    const sourceText = `${thread.title || ""}. ${thread.body || ""}`;
    const topic = inferDiscussionTopic(sourceText);
    const activityHint =
      thread?._count?.posts > 0
        ? ` The thread has ${thread._count.posts} post${thread._count.posts === 1 ? "" : "s"} so far.`
        : "";
    return `${communityLabel} are debating ${topic}.${activityHint}`;
  });

  if (topItems.length === 1) {
    return topItems[0];
  }

  return `${topItems[0]} Meanwhile, ${topItems[1]}`;
}

function buildRecordedMatchesDraft(matches: DigestMatch[]) {
  if (!matches.length) {
    return DIGEST_FALLBACKS.recordedMatches;
  }

  const lines = matches.slice(0, 3).map((match) => {
    const home = cleanClubName(match?.homeTeam?.name || "Home");
    const away = cleanClubName(match?.awayTeam?.name || "Away");
    const homeScore = match?.homeScore ?? 0;
    const awayScore = match?.awayScore ?? 0;

    if (homeScore > awayScore) {
      return `${home} beat ${away} ${homeScore}-${awayScore}`;
    }

    if (awayScore > homeScore) {
      return `${away} beat ${home} ${awayScore}-${homeScore}`;
    }

    return `${home} and ${away} drew ${homeScore}-${awayScore}`;
  });

  if (lines.length === 1) {
    return `Latest result: ${lines[0]}.`;
  }

  return `Recent results: ${lines.join("; ")}.`;
}

function buildStandingsBreakdown(standings: DigestStanding[]): StandingsBreakdown {
  if (!standings.length) {
    return {
      titleRace: null,
      topFour: null,
      relegation: null,
    };
  }

  const sorted = [...standings].sort((a, b) => a.position - b.position);
  const byPosition = new Map(sorted.map((row) => [row.position, row]));

  let titleRace: string | null = null;
  let topFour: string | null = null;
  let relegation: string | null = null;

  const first = byPosition.get(1);
  const second = byPosition.get(2);
  if (first && second) {
    const gap = first.points - second.points;
    titleRace = `${cleanClubName(first.team.name)} lead ${cleanClubName(second.team.name)} by ${gap} point${Math.abs(gap) === 1 ? "" : "s"} (${first.points}-${second.points}).`;
  }

  const fourth = byPosition.get(4);
  const fifth = byPosition.get(5);
  if (fourth && fifth) {
    const gap = fourth.points - fifth.points;
    topFour = `${cleanClubName(fourth.team.name)} in 4th are ${gap} point${Math.abs(gap) === 1 ? "" : "s"} clear of ${cleanClubName(fifth.team.name)} in 5th.`;
  }

  const seventeenth = byPosition.get(17);
  const eighteenth = byPosition.get(18);
  if (seventeenth && eighteenth) {
    const gap = seventeenth.points - eighteenth.points;
    relegation = `${cleanClubName(seventeenth.team.name)} are ${gap} point${Math.abs(gap) === 1 ? "" : "s"} above ${cleanClubName(eighteenth.team.name)}.`;
  }

  return {
    titleRace,
    topFour,
    relegation,
  };
}

function buildStandingsDraft(standings: DigestStanding[]) {
  const breakdown = buildStandingsBreakdown(standings);
  const lines = [breakdown.titleRace, breakdown.topFour, breakdown.relegation].filter(Boolean);
  if (lines.length > 0) {
    return lines.join(" ");
  }

  const sorted = [...standings].sort((a, b) => a.position - b.position);
  const topFive = sorted.slice(0, 5);
  const fallbackLine = topFive
    .map((standing) => `${standing.position}. ${cleanClubName(standing.team.name)} (${standing.points} pts)`)
    .join(", ");
  return fallbackLine ? `${fallbackLine}.` : DIGEST_FALLBACKS.standings;
}

async function polishDigestSection(
  sectionLabel: string,
  deterministicDraft: string,
  fallback: string
): Promise<DigestSectionResult> {
  const draft = String(deterministicDraft || "").trim();
  if (!draft || draft === fallback) {
    return {
      text: fallback,
      usedAi: false,
      source: "fallback-empty",
    };
  }

  const aiText = await generateDigest(`Daily digest ${sectionLabel}: ${draft}`);
  const normalized = normalizeAiText(aiText || "");

  if (!normalized) {
    return {
      text: draft,
      usedAi: false,
      source: "deterministic-empty-ai",
    };
  }

  if (normalized.length > 360) {
    return {
      text: draft,
      usedAi: false,
      source: "deterministic-too-long",
    };
  }

  if (/https?:\/\/|click here|read more/i.test(normalized)) {
    return {
      text: draft,
      usedAi: false,
      source: "deterministic-linky-ai",
    };
  }

  if (containsPromptLeakage(normalized)) {
    return {
      text: draft,
      usedAi: false,
      source: "deterministic-prompt-leak",
    };
  }

  if (hasUnexpectedNumbers(normalized, [draft])) {
    return {
      text: draft,
      usedAi: false,
      source: "deterministic-unexpected-number",
    };
  }

  if (!hasFactOverlap(normalized, [draft])) {
    return {
      text: draft,
      usedAi: false,
      source: "deterministic-low-overlap",
    };
  }

  return {
    text: normalized,
    usedAi: true,
    source: "ai-polished",
  };
}

async function buildDigestPayload(): Promise<DigestPayload> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [threads, matches, standings] = await Promise.all([
    prisma.thread.findMany({
      where: {
        isHidden: false,
        createdAt: { gte: yesterday },
      },
      orderBy: { posts: { _count: "desc" } },
      take: 5,
      include: {
        _count: { select: { posts: true } },
        author: { select: { username: true } },
        team: { select: { name: true } },
      },
    }),
    prisma.match.findMany({
      where: {
        status: "FINISHED",
        utcDate: { gte: yesterday },
      },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
      orderBy: { utcDate: "desc" },
      take: 5,
    }),
    (async () => {
      const latestStanding = await prisma.standing.findFirst({
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { season: true },
      });

      if (!latestStanding?.season) {
        return [];
      }

      return prisma.standing.findMany({
        where: { season: latestStanding.season },
        orderBy: { position: "asc" },
        include: {
          team: { select: { name: true } },
        },
      });
    })(),
  ]);

  const discussionDraft = buildTopDiscussionsDraft(threads);
  const matchesDraft = buildRecordedMatchesDraft(matches);
  const standingsDraft = buildStandingsDraft(standings);
  const standingsBreakdown = buildStandingsBreakdown(standings);

  const [discussionSection, matchSection, standingsSection] = await Promise.all([
    polishDigestSection("Top Discussions", discussionDraft, DIGEST_FALLBACKS.topDiscussions),
    polishDigestSection("Recorded Matches", matchesDraft, DIGEST_FALLBACKS.recordedMatches),
    polishDigestSection("Standings Update", standingsDraft, DIGEST_FALLBACKS.standings),
  ]);

  const digestSections = {
    topDiscussions: discussionSection.text,
    recordedMatches: matchSection.text,
    standings: standingsSection.text,
    standingsBreakdown: {
      titleRace: standingsBreakdown.titleRace,
      topFourRace: standingsBreakdown.topFour,
      relegationRace: standingsBreakdown.relegation,
    },
  };

  const digest = [
    `Top Discussions: ${digestSections.topDiscussions}`,
    `Recorded Matches: ${digestSections.recordedMatches}`,
    `Standings Update: ${digestSections.standings}`,
  ].join("\n\n");

  return {
    generatedAt: new Date().toISOString(),
    digest,
    digestSections,
    digestMeta: {
      topDiscussionsSource: discussionSection.source,
      recordedMatchesSource: matchSection.source,
      standingsSource: standingsSection.source,
      usedAiForAllSections:
        discussionSection.usedAi && matchSection.usedAi && standingsSection.usedAi,
    },
    data: {
      recentMatches: matches,
      topThreads: threads,
      standings: standings.slice(0, 5),
    },
  };
}

async function getFreshSharedDigestPayload() {
  return getCacheJson<DigestPayload>(DIGEST_SHARED_CACHE_KEY);
}

async function getStaleSharedDigestPayload() {
  return getCacheJson<DigestPayload>(DIGEST_SHARED_STALE_CACHE_KEY);
}

async function writeSharedDigestPayload(payload: DigestPayload) {
  await Promise.all([
    setCacheJson(DIGEST_SHARED_CACHE_KEY, payload, DIGEST_SHARED_TTL_MS),
    setCacheJson(DIGEST_SHARED_STALE_CACHE_KEY, payload, DIGEST_STALE_TTL_MS),
  ]);
}

async function getOrBuildSharedDigestPayload() {
  const fresh = await getFreshSharedDigestPayload();
  if (fresh) {
    return { payload: fresh, cacheStatus: "hit" as const };
  }

  if (sharedDigestInFlight) {
    const payload = await sharedDigestInFlight;
    return { payload, cacheStatus: "wait" as const };
  }

  sharedDigestInFlight = buildDigestPayload()
    .then(async (payload) => {
      await writeSharedDigestPayload(payload);
      return payload;
    })
    .finally(() => {
      sharedDigestInFlight = null;
    });

  const payload = await sharedDigestInFlight;
  return { payload, cacheStatus: "miss" as const };
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    let requesterUserId: number | null = null;

    if (authHeader) {
      if (!authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const token = authHeader.split(" ")[1];
      const payload = verifyAccessToken(token);
      if (!payload) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
      requesterUserId = Number(payload.userId) || null;
    }

    // Serve fresh cache immediately without abuse checks.
    const freshPayload = await getFreshSharedDigestPayload();
    if (freshPayload) {
      return NextResponse.json(freshPayload, {
        headers: {
          "X-Digest-Cache": "hit",
          "Cache-Control": "private, no-store",
        },
      });
    }

    // If another request is already regenerating, wait for it instead of rate-limiting.
    if (sharedDigestInFlight) {
      try {
        const payload = await sharedDigestInFlight;
        return NextResponse.json(payload, {
          headers: {
            "X-Digest-Cache": "wait",
            "Cache-Control": "private, no-store",
          },
        });
      } catch (generationError) {
        const stalePayload = await getStaleSharedDigestPayload();
        if (stalePayload) {
          return NextResponse.json(
            {
              ...stalePayload,
              digestMeta: {
                ...stalePayload.digestMeta,
                servedStale: true,
              },
            },
            {
              headers: {
                "X-Digest-Cache": "stale",
                "Cache-Control": "private, no-store",
              },
            }
          );
        }
        throw generationError;
      }
    }

    // Only enforce abuse protection when a new regeneration is needed.
    const abuseError = enforceDigestAbuseProtection(request, requesterUserId);
    if (abuseError) return abuseError;

    try {
      const { payload, cacheStatus } = await getOrBuildSharedDigestPayload();
      return NextResponse.json(payload, {
        headers: {
          "X-Digest-Cache": cacheStatus,
          "Cache-Control": "private, no-store",
        },
      });
    } catch (generationError) {
      const stalePayload = await getStaleSharedDigestPayload();
      if (stalePayload) {
        return NextResponse.json(
          {
            ...stalePayload,
            digestMeta: {
              ...stalePayload.digestMeta,
              servedStale: true,
            },
          },
          {
            headers: {
              "X-Digest-Cache": "stale",
              "Cache-Control": "private, no-store",
            },
          }
        );
      }
      throw generationError;
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
