import type { HomeFeedItem } from "@/components/home/types";

import { buildThreadHref } from "@/lib/threadLinks";

type FeedActor = {
  id: number;
  username: string;
  avatar: string | null;
};

type ThreadEntity = {
  id: number;
  kind: "thread";
  threadType?: string;
  title?: string | null;
  teamId?: number | null;
  teamName?: string | null;
  teamCrestUrl?: string | null;
  directPostCount?: number | null;
  matchId?: number | null;
  matchData?: {
    id: number;
    matchWeek?: number;
    season?: string;
    status?: string;
    kickoff?: string;
    homeTeam?: { id: number; name: string; shortName: string | null; crestUrl?: string | null };
    awayTeam?: { id: number; name: string; shortName: string | null; crestUrl?: string | null };
    score?: { home: number | null; away: number | null };
  } | null;
};

type PostEntity = {
  id: number;
  kind: "post";
  threadId: number;
  threadTitle?: string | null;
  threadType?: string | null;
  threadTeamName?: string | null;
  threadTeamCrestUrl?: string | null;
  parentId?: number | null;
  parentAuthorUsername?: string | null;
  directReplyCount?: number | null;
  isReply?: boolean;
};

type MatchEntity = {
  id: number;
  kind: "match";
  threadId?: number | null;
  matchWeek?: number;
  season?: string;
  status?: string;
  kickoff?: string;
  favoriteTeam?: { id: number; name: string; shortName: string | null; crestUrl?: string | null };
  opponent?: { id: number; name: string; shortName: string | null; crestUrl?: string | null };
  score?: { home: number | null; away: number | null };
};

type UserEntity = {
  id: number;
  kind: "user";
  username?: string | null;
  avatar?: string | null;
};

type FeedEntity = ThreadEntity | PostEntity | MatchEntity | UserEntity;

type ApiFeedItem = {
  id: string;
  type:
    | "FOLLOWED_USER_THREAD"
    | "FOLLOWED_USER_POST"
    | "REPLY_TO_MY_POST"
    | "REPLIES_TO_MY_POST_GROUP"
    | "POST_IN_MY_THREAD"
    | "POSTS_IN_MY_THREAD_GROUP"
    | "NEW_FOLLOWER"
    | "FAVORITE_TEAM_MATCH_SCORE"
    | "FAVORITE_TEAM_THREAD"
    | "FAVORITE_TEAM_THREAD_GROUP"
    | "FAVORITE_TEAM_MATCH_THREAD";
  createdAt: string;
  actor: FeedActor | null;
  entity: FeedEntity;
  summary: string;
};

export type ApiFeedResponse = {
  items?: ApiFeedItem[];
};

function isThreadEntity(entity: FeedEntity): entity is ThreadEntity {
  return entity.kind === "thread";
}

function formatRelativeTime(isoDate: string): string {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return "recent";

  const deltaMs = Date.now() - parsed;
  if (deltaMs < 60_000) return "just now";

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function mapEntityHref(item: ApiFeedItem): string {
  if (item.type === "FAVORITE_TEAM_MATCH_SCORE" && item.entity.kind === "match") {
    if (typeof item.entity.threadId === "number") {
      return buildThreadHref(item.entity.threadId, {
        source: "feed",
        event: item.type,
      });
    }
    return `/matches?matchId=${item.entity.id}&source=feed`;
  }

  if (item.entity.kind === "thread") {
    return buildThreadHref(item.entity.id, {
      source: "feed",
      event: item.type,
    });
  }

  if (item.entity.kind === "post") {
    return buildThreadHref(
      item.entity.threadId,
      {
        source: "feed",
        event: item.type,
      },
      {
        view: "single-comment",
        postId: item.entity.id,
      }
    );
  }

  if (item.entity.kind === "user") {
    return `/users/${item.entity.id}`;
  }

  return "/discussions";
}

function mapItemType(type: ApiFeedItem["type"]): HomeFeedItem["type"] {
  if (type === "FOLLOWED_USER_THREAD" || type === "FOLLOWED_USER_POST" || type === "NEW_FOLLOWER") {
    return "following";
  }
  if (
    type === "REPLY_TO_MY_POST" ||
    type === "REPLIES_TO_MY_POST_GROUP" ||
    type === "POST_IN_MY_THREAD" ||
    type === "POSTS_IN_MY_THREAD_GROUP"
  ) {
    return "reply";
  }
  return "team-update";
}

function isGroupedEvent(type: ApiFeedItem["type"]) {
  return (
    type === "REPLIES_TO_MY_POST_GROUP" ||
    type === "POSTS_IN_MY_THREAD_GROUP" ||
    type === "FAVORITE_TEAM_THREAD_GROUP"
  );
}

function buildTitle(item: ApiFeedItem): string {
  if (item.type === "FOLLOWED_USER_THREAD") {
    if (item.entity.kind === "thread" && item.entity.title) {
      return item.entity.title;
    }
    return "New thread from someone you follow";
  }

  if (item.type === "FOLLOWED_USER_POST") {
    if (item.entity.kind === "post" && item.entity.threadTitle) {
      return item.entity.threadTitle;
    }
    return "New post from someone you follow";
  }

  if (item.type === "REPLY_TO_MY_POST") {
    const author = item.actor?.username ?? "A user";
    return `${author} replied to your post`;
  }

  if (item.type === "REPLIES_TO_MY_POST_GROUP" && item.entity.kind === "post") {
    const count = item.entity.directReplyCount ?? 0;
    return count === 1 ? "New reply on your comment" : `${count} new replies on your comment`;
  }

  if (item.type === "POST_IN_MY_THREAD") {
    const author = item.actor?.username ?? "A user";
    if (item.entity.kind === "post" && item.entity.threadTitle) {
      return `${author} posted in your thread`;
    }
    return `${author} posted in your discussion`;
  }

  if (item.type === "POSTS_IN_MY_THREAD_GROUP" && item.entity.kind === "thread") {
    const count = item.entity.directPostCount ?? 0;
    return count === 1 ? "New post in your thread" : `${count} new posts in your thread`;
  }

  if (item.type === "FAVORITE_TEAM_THREAD") {
    return "New thread in your favorite team forum";
  }

  if (item.type === "FAVORITE_TEAM_THREAD_GROUP" && item.entity.kind === "thread") {
    const count = item.entity.directPostCount ?? 0;
    return count === 1
      ? "New thread in your favorite team forum"
      : `${count} new threads in your favorite team forum`;
  }

  if (item.type === "NEW_FOLLOWER") {
    const follower = item.actor?.username ?? "A user";
    return `${follower} started following you`;
  }

  const entity = item.entity;
  if (item.type === "FAVORITE_TEAM_MATCH_THREAD" && isThreadEntity(entity) && entity.matchData) {
    const home = entity.matchData.homeTeam?.name ?? "Home";
    const away = entity.matchData.awayTeam?.name ?? "Away";
    return `Match Thread: ${home} vs ${away}`;
  }

  return item.summary || "Match update";
}

function buildContext(item: ApiFeedItem): string {
  if (item.type === "FOLLOWED_USER_THREAD" && item.entity.kind === "thread") {
    if (item.entity.threadType === "TEAM" && item.entity.teamName) {
      return `Team forum: ${item.entity.teamName}`;
    }
    if (item.entity.threadType === "MATCH") {
      return "Match thread";
    }
    return "General discussion";
  }

  if (item.type === "FOLLOWED_USER_POST" && item.entity.kind === "post") {
    if (item.entity.threadType === "TEAM" && item.entity.threadTeamName) {
      return `Team forum: ${item.entity.threadTeamName}`;
    }
    if (item.entity.threadTitle) {
      return `Posted in: ${item.entity.threadTitle}`;
    }
    return "Posted in a discussion thread";
  }

  if (item.type === "NEW_FOLLOWER") {
    if (item.entity.kind === "user" && item.entity.username) {
      return `Follower: ${item.entity.username}`;
    }
    if (item.actor?.username) {
      return `Follower: ${item.actor.username}`;
    }
    return "Follower update";
  }

  if (item.entity.kind === "thread" && item.entity.title) {
    if (item.type === "POSTS_IN_MY_THREAD_GROUP") {
      return `Your thread: ${item.entity.title}`;
    }
    if (item.type === "FAVORITE_TEAM_THREAD_GROUP") {
      return item.entity.teamName ? `${item.entity.teamName} community` : "Favorite team community";
    }
    return item.entity.title;
  }

  if (item.entity.kind === "post" && item.entity.threadTitle) {
    if (item.type === "REPLIES_TO_MY_POST_GROUP") {
      return `Posted in: ${item.entity.threadTitle}`;
    }
    return item.entity.threadTitle;
  }

  if (item.type === "FAVORITE_TEAM_MATCH_SCORE" && item.entity.kind === "match") {
    const favorite = item.entity.favoriteTeam?.shortName || item.entity.favoriteTeam?.name;
    const opponent = item.entity.opponent?.shortName || item.entity.opponent?.name;
    if (favorite && opponent) {
      return `${favorite} vs ${opponent}`;
    }
  }

  const entity = item.entity;
  if (item.type === "FAVORITE_TEAM_MATCH_THREAD" && isThreadEntity(entity) && entity.matchData) {
    const home = entity.matchData.homeTeam?.name ?? "Home";
    const away = entity.matchData.awayTeam?.name ?? "Away";
    const matchWeek = entity.matchData.matchWeek;
    return matchWeek != null
      ? `Match Thread: ${home} vs ${away} | Matchweek ${matchWeek}`
      : `Match Thread: ${home} vs ${away}`;
  }

  return "SportsDeck feed";
}

function buildMatchInfo(item: ApiFeedItem): HomeFeedItem["matchInfo"] | undefined {
  if (item.type === "FAVORITE_TEAM_MATCH_SCORE" && item.entity.kind === "match") {
    const homeName = item.entity.favoriteTeam?.name ?? "Home";
    const awayName = item.entity.opponent?.name ?? "Away";
    const homeShort = item.entity.favoriteTeam?.shortName ?? homeName;
    const awayShort = item.entity.opponent?.shortName ?? awayName;

    return {
      homeTeam: {
        name: homeName,
        shortName: homeShort,
        crestUrl: item.entity.favoriteTeam?.crestUrl ?? null,
      },
      awayTeam: {
        name: awayName,
        shortName: awayShort,
        crestUrl: item.entity.opponent?.crestUrl ?? null,
      },
      score: {
        home: item.entity.score?.home ?? null,
        away: item.entity.score?.away ?? null,
      },
      status: item.entity.status ?? "UPDATE",
      matchWeek: typeof item.entity.matchWeek === "number" ? item.entity.matchWeek : null,
      leagueLabel: "Premier League",
    };
  }

  const entity = item.entity;
  if (item.type === "FAVORITE_TEAM_MATCH_THREAD" && isThreadEntity(entity) && entity.matchData) {
    const matchData = entity.matchData;
    const homeName = matchData.homeTeam?.name ?? "Home";
    const awayName = matchData.awayTeam?.name ?? "Away";
    const homeShort = matchData.homeTeam?.shortName ?? homeName;
    const awayShort = matchData.awayTeam?.shortName ?? awayName;

    return {
      homeTeam: {
        name: homeName,
        shortName: homeShort,
        crestUrl: matchData.homeTeam?.crestUrl ?? null,
      },
      awayTeam: {
        name: awayName,
        shortName: awayShort,
        crestUrl: matchData.awayTeam?.crestUrl ?? null,
      },
      score: {
        home: matchData.score?.home ?? null,
        away: matchData.score?.away ?? null,
      },
      status: matchData.status ?? "MATCH",
      matchWeek: typeof matchData.matchWeek === "number" ? matchData.matchWeek : null,
      leagueLabel: "Premier League",
    };
  }

  return undefined;
}

function toHomeFeedItem(item: ApiFeedItem): HomeFeedItem {
  const createdAtMs = Date.parse(item.createdAt);
  const contextCrestUrl =
    item.entity.kind === "thread" && item.entity.threadType === "TEAM"
      ? item.entity.teamCrestUrl ?? null
      : item.entity.kind === "post" && item.entity.threadType === "TEAM"
        ? item.entity.threadTeamCrestUrl ?? null
        : null;
  const contextCrestAlt =
    item.entity.kind === "thread" && item.entity.threadType === "TEAM"
      ? item.entity.teamName
        ? `${item.entity.teamName} crest`
        : "Team crest"
      : item.entity.kind === "post" && item.entity.threadType === "TEAM"
        ? item.entity.threadTeamName
          ? `${item.entity.threadTeamName} crest`
          : "Team crest"
        : null;
  const postRelation =
    item.entity.kind === "post" && !isGroupedEvent(item.type)
      ? item.entity.parentId != null && item.entity.parentAuthorUsername
        ? {
            kind: "replying-to" as const,
            label: item.entity.parentAuthorUsername,
          }
        : item.entity.threadTitle
          ? {
              kind: "in-thread" as const,
              label: item.entity.threadTitle,
            }
          : null
      : null;
  const engagement =
    item.entity.kind === "post"
      ? {
          directCount: item.entity.directReplyCount ?? 0,
          unit: "replies" as const,
        }
      : item.entity.kind === "thread"
        ? {
            directCount: item.entity.directPostCount ?? 0,
            unit: "posts" as const,
          }
        : null;

  return {
    id: item.id,
    type: mapItemType(item.type),
    isGrouped: isGroupedEvent(item.type),
    originKind: item.entity?.kind ?? "other",
    title: buildTitle(item),
    summary: item.summary,
    context: buildContext(item),
    postRelation,
    engagement,
    contextCrestUrl,
    contextCrestAlt,
    actor: item.actor
      ? {
          username: item.actor.username,
          avatar: item.actor.avatar,
        }
      : null,
    timestampLabel: formatRelativeTime(item.createdAt),
    createdAtMs: Number.isNaN(createdAtMs) ? 0 : createdAtMs,
    href: mapEntityHref(item),
    matchInfo: buildMatchInfo(item),
  };
}

export function normalizeFeedItems(payload: ApiFeedResponse): HomeFeedItem[] {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  const mapped = rawItems.map(toHomeFeedItem);
  mapped.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return mapped;
}
