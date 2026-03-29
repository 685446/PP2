import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/prisma/db";
import { authenticate } from "@/lib/middleware";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;
const SOURCE_LIMIT = 200;
const RECENT_MATCH_THREAD_WINDOW_MS = 24 * 60 * 60 * 1000;

type SearchParamsLike = Pick<URLSearchParams, "get">;

type FeedActor = {
  id: number;
  username: string;
  avatar: string | null;
};

type FeedThread = {
  id: number;
  title: string;
  body: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: Date;
  openAt: Date;
  teamId: number | null;
  matchId: number | null;
  author: FeedActor;
  team?: {
    name: string;
    crestUrl: string | null;
  } | null;
  match?: {
    id: number;
    matchWeek: number | null;
    season: string | null;
    status: string;
    utcDate: Date;
    homeScore: number | null;
    awayScore: number | null;
    homeTeam: {
      id: number;
      name: string;
      shortName: string;
      crestUrl: string | null;
    };
    awayTeam: {
      id: number;
      name: string;
      shortName: string;
      crestUrl: string | null;
    };
  } | null;
};

type FeedPost = {
  id: number;
  content: string;
  createdAt: Date;
  threadId: number;
  parentId: number | null;
  author: FeedActor;
  thread?: {
    title: string;
    type?: "GENERAL" | "TEAM" | "MATCH" | null;
    team?: {
      name: string;
      crestUrl: string | null;
    } | null;
  } | null;
  parent?: {
    author?: {
      username: string;
    } | null;
  } | null;
};

type FeedMatch = {
  id: number;
  matchWeek: number | null;
  season: string | null;
  status: string;
  utcDate: Date;
  updatedAt: Date;
  homeScore: number | null;
  awayScore: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: {
    id: number;
    name: string;
    shortName: string;
    crestUrl: string | null;
  };
  awayTeam: {
    id: number;
    name: string;
    shortName: string;
    crestUrl: string | null;
  };
  thread?: {
    id: number;
  } | null;
};

type FeedFollow = {
  followerId: number;
  followingId: number;
  createdAt: Date;
  follower: FeedActor;
};

function buildPreviewText(value: unknown, fallback = "No preview available yet.") {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function parsePagination(searchParams: SearchParamsLike) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function parseSince(searchParams: SearchParamsLike) {
  const earliestAllowed = new Date(Date.now() - DEFAULT_DAYS * DAY_MS);
  const rawSince = searchParams.get("since");
  if (!rawSince) {
    return earliestAllowed;
  }

  const since = new Date(rawSince);
  if (Number.isNaN(since.getTime())) {
    return null;
  }
  return since < earliestAllowed ? earliestAllowed : since;
}

function eventFromFollowedThread(thread: FeedThread, directPostCount = 0) {
  return {
    id: `followed-thread-${thread.id}`,
    type: "FOLLOWED_USER_THREAD",
    createdAt: thread.createdAt,
    actor: thread.author,
    entity: {
      id: thread.id,
      kind: "thread",
      threadType: thread.type,
      title: thread.title,
      teamId: thread.teamId,
      matchId: thread.matchId,
      teamName: thread.team?.name || null,
      teamCrestUrl: thread.team?.crestUrl || null,
      directPostCount,
    },
    summary: buildPreviewText(thread.body),
  };
}

function eventFromFollowedPost(post: FeedPost, directReplyCount = 0) {
  return {
    id: `followed-post-${post.id}`,
    type: "FOLLOWED_USER_POST",
    createdAt: post.createdAt,
    actor: post.author,
    entity: {
      id: post.id,
      kind: "post",
      threadId: post.threadId,
      threadTitle: post.thread?.title || null,
      threadType: post.thread?.type || null,
      threadTeamName: post.thread?.team?.name || null,
      threadTeamCrestUrl: post.thread?.team?.crestUrl || null,
      isReply: post.parentId !== null,
      parentId: post.parentId,
      parentAuthorUsername: post.parent?.author?.username || null,
      directReplyCount,
    },
    summary: buildPreviewText(post.content),
  };
}

function eventFromReplyToMyPost(post: FeedPost, directReplyCount = 0) {
  return {
    id: `reply-to-my-post-${post.id}`,
    type: "REPLY_TO_MY_POST",
    createdAt: post.createdAt,
    actor: post.author,
    entity: {
      id: post.id,
      kind: "post",
      threadId: post.threadId,
      threadTitle: post.thread?.title || null,
      parentId: post.parentId,
      parentAuthorUsername: post.parent?.author?.username || null,
      directReplyCount,
    },
    summary: `${post.author.username} replied to your post`,
  };
}

function eventFromPostInMyThread(post: FeedPost, directReplyCount = 0) {
  return {
    id: `post-in-my-thread-${post.id}`,
    type: "POST_IN_MY_THREAD",
    createdAt: post.createdAt,
    actor: post.author,
    entity: {
      id: post.id,
      kind: "post",
      threadId: post.threadId,
      threadTitle: post.thread?.title || null,
      parentId: post.parentId,
      parentAuthorUsername: post.parent?.author?.username || null,
      isReply: post.parentId !== null,
      directReplyCount,
    },
    summary: `${post.author.username} posted in your thread "${post.thread?.title || ""}"`.trim(),
  };
}

function eventFromNewFollower(follow: FeedFollow) {
  return {
    id: `new-follower-${follow.followerId}-${follow.followingId}`,
    type: "NEW_FOLLOWER",
    createdAt: follow.createdAt,
    actor: follow.follower,
    entity: {
      id: follow.follower.id,
      kind: "user",
      username: follow.follower.username,
      avatar: follow.follower.avatar ?? null,
    },
    summary: `${follow.follower.username} started following you`,
  };
}

function eventFromFavoriteTeamMatch(match: FeedMatch, favoriteTeamId: number) {
  const isHomeFavorite = match.homeTeamId === favoriteTeamId;
  const favoriteTeam = isHomeFavorite ? match.homeTeam : match.awayTeam;
  const opponent = isHomeFavorite ? match.awayTeam : match.homeTeam;

  return {
    id: `favorite-team-match-${match.id}`,
    type: "FAVORITE_TEAM_MATCH_SCORE",
    createdAt: match.updatedAt,
    actor: null,
    entity: {
      id: match.id,
      kind: "match",
      threadId: match.thread?.id ?? null,
      matchWeek: match.matchWeek,
      season: match.season,
      status: match.status,
      kickoff: match.utcDate,
      favoriteTeam: {
        id: favoriteTeam.id,
        name: favoriteTeam.name,
        shortName: favoriteTeam.shortName,
        crestUrl: favoriteTeam.crestUrl ?? null,
      },
      opponent: {
        id: opponent.id,
        name: opponent.name,
        shortName: opponent.shortName,
        crestUrl: opponent.crestUrl ?? null,
      },
      score: {
        home: match.homeScore,
        away: match.awayScore,
      },
    },
    summary: `Score update: ${match.homeTeam.shortName} ${match.homeScore ?? "-"}-${match.awayScore ?? "-"} ${match.awayTeam.shortName}`,
  };
}

function eventFromFavoriteTeamThread(thread: FeedThread, directPostCount = 0) {
  return {
    id: `favorite-team-thread-${thread.id}`,
    type: "FAVORITE_TEAM_THREAD",
    createdAt: thread.createdAt,
    actor: thread.author,
    entity: {
      id: thread.id,
      kind: "thread",
      threadType: thread.type,
      title: thread.title,
      teamId: thread.teamId,
      directPostCount,
    },
    summary: "New thread in your favorite team's forum",
  };
}

function eventFromFavoriteTeamMatchThread(thread: FeedThread, directPostCount = 0) {
  return {
    id: `favorite-team-match-thread-${thread.id}`,
    type: "FAVORITE_TEAM_MATCH_THREAD",
    // Use thread opening time so the card reflects when discussion actually opened.
    createdAt: thread.openAt,
    actor: thread.author,
    entity: {
      id: thread.id,
      kind: "thread",
      threadType: thread.type,
      title: thread.title,
      teamId: thread.teamId,
      matchId: thread.matchId,
      directPostCount,
      matchData: thread.match
        ? {
            id: thread.match.id,
            matchWeek: thread.match.matchWeek,
            season: thread.match.season,
            status: thread.match.status,
            kickoff: thread.match.utcDate,
            homeTeam: thread.match.homeTeam,
            awayTeam: thread.match.awayTeam,
            score: {
              home: thread.match.homeScore,
              away: thread.match.awayScore,
            },
          }
        : null,
    },
    summary: "Match thread is active for your favorite team",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticate(request);
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const { page, limit, skip } = parsePagination(searchParams);
    const since = parseSince(searchParams);
    if (!since) {
      return NextResponse.json(
        { error: "since must be a valid ISO date string" },
        { status: 400 }
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, favoriteTeamId: true },
    });
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const following = await prisma.follow.findMany({
      where: { followerId: user.id },
      select: { followingId: true },
    });
    const followedUserIds = following.map((row) => row.followingId);
    const favoriteTeamId = dbUser.favoriteTeamId;
    const now = new Date();
    const recentlyClosedAt = new Date(now.getTime() - RECENT_MATCH_THREAD_WINDOW_MS);

    const [
      followedThreads,
      followedPosts,
      repliesToMyPosts,
      postsInMyThreads,
      newFollowers,
      favoriteTeamMatches,
      favoriteTeamThreads,
      favoriteTeamMatchThreads,
    ] = await Promise.all([
      followedUserIds.length
        ? prisma.thread.findMany({
            where: {
              authorId: { in: followedUserIds },
              isHidden: false,
              createdAt: { gte: since },
            },
            take: SOURCE_LIMIT,
            orderBy: { createdAt: "desc" },
            include: {
              author: {
                select: { id: true, username: true, avatar: true },
              },
              team: {
                select: { id: true, name: true, crestUrl: true },
              },
            },
          })
        : Promise.resolve([]),
      followedUserIds.length
        ? prisma.post.findMany({
            where: {
              authorId: { in: followedUserIds },
              isHidden: false,
              isDeleted: false,
              createdAt: { gte: since },
              thread: { isHidden: false },
            },
            take: SOURCE_LIMIT,
            orderBy: { createdAt: "desc" },
            include: {
              author: {
                select: { id: true, username: true, avatar: true },
              },
              thread: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  team: {
                    select: { id: true, name: true, crestUrl: true },
                  },
                },
              },
              parent: {
                select: {
                  author: {
                    select: { username: true },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.post.findMany({
        where: {
          isHidden: false,
          isDeleted: false,
          authorId: { not: user.id },
          createdAt: { gte: since },
          parent: {
            is: {
              authorId: user.id,
              isHidden: false,
              isDeleted: false,
            },
          },
          thread: { isHidden: false },
        },
        take: SOURCE_LIMIT,
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: { id: true, username: true, avatar: true },
          },
          thread: {
            select: { id: true, title: true },
          },
          parent: {
            select: {
              author: {
                select: { username: true },
              },
            },
          },
        },
      }),
      prisma.post.findMany({
        where: {
          isHidden: false,
          isDeleted: false,
          authorId: { not: user.id },
          createdAt: { gte: since },
          thread: {
            isHidden: false,
            authorId: user.id,
          },
          NOT: {
            parent: {
              is: {
                authorId: user.id,
              },
            },
          },
        },
        take: SOURCE_LIMIT,
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: { id: true, username: true, avatar: true },
          },
          thread: {
            select: { id: true, title: true },
          },
          parent: {
            select: {
              author: {
                select: { username: true },
              },
            },
          },
        },
      }),
      prisma.follow.findMany({
        where: {
          followingId: user.id,
          followerId: { not: user.id },
          createdAt: { gte: since },
        },
        take: SOURCE_LIMIT,
        orderBy: { createdAt: "desc" },
        include: {
          follower: {
            select: { id: true, username: true, avatar: true },
          },
        },
      }),
      favoriteTeamId
        ? prisma.match.findMany({
            where: {
              OR: [
                { homeTeamId: favoriteTeamId },
                { awayTeamId: favoriteTeamId },
              ],
              status: "FINISHED",
              // Guard against old fixtures resurfacing when sync touches updatedAt.
              utcDate: { gte: since },
              updatedAt: { gte: since },
            },
            take: SOURCE_LIMIT,
            orderBy: { updatedAt: "desc" },
            include: {
              homeTeam: {
                select: { id: true, name: true, shortName: true, crestUrl: true },
              },
              awayTeam: {
                select: { id: true, name: true, shortName: true, crestUrl: true },
              },
              thread: {
                select: { id: true },
              },
            },
          })
        : Promise.resolve([]),
      favoriteTeamId
        ? prisma.thread.findMany({
            where: {
              teamId: favoriteTeamId,
              type: "TEAM",
              isHidden: false,
              createdAt: { gte: since },
            },
            take: SOURCE_LIMIT,
            orderBy: { createdAt: "desc" },
            include: {
              author: {
                select: { id: true, username: true, avatar: true },
              },
            },
          })
        : Promise.resolve([]),
      favoriteTeamId
        ? prisma.thread.findMany({
            where: {
              type: "MATCH",
              isHidden: false,
              openAt: { lte: now },
              OR: [{ closedAt: null }, { closedAt: { gte: recentlyClosedAt } }],
              match: {
                OR: [
                  { homeTeamId: favoriteTeamId },
                  { awayTeamId: favoriteTeamId },
                ],
              },
            },
            take: SOURCE_LIMIT,
            orderBy: { openAt: "desc" },
            include: {
              author: {
                select: { id: true, username: true, avatar: true },
              },
              match: {
                select: {
                  id: true,
                  matchWeek: true,
                  season: true,
                  status: true,
                  utcDate: true,
                  homeScore: true,
                  awayScore: true,
                  homeTeam: {
                    select: { id: true, name: true, shortName: true, crestUrl: true },
                  },
                  awayTeam: {
                    select: { id: true, name: true, shortName: true, crestUrl: true },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // Avoid duplicate cards for the same match when a match-thread event also exists.
    const matchIdsWithThreadEvents = new Set(
      favoriteTeamMatchThreads
        .map((thread) => thread.match?.id)
        .filter((id): id is number => typeof id === "number")
    );
    const threadIdsForDirectPosts = [
      ...new Set(
        [...followedThreads, ...favoriteTeamThreads, ...favoriteTeamMatchThreads].map(
          (thread) => thread.id
        )
      ),
    ];
    const postIdsForDirectReplies = [
      ...new Set(
        [...followedPosts, ...repliesToMyPosts, ...postsInMyThreads].map((post) => post.id)
      ),
    ];

    const [directPostRows, directReplyRows] = await Promise.all([
      threadIdsForDirectPosts.length
        ? prisma.post.groupBy({
            by: ["threadId"],
            where: {
              threadId: { in: threadIdsForDirectPosts },
              isHidden: false,
              isDeleted: false,
              parentId: null,
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      postIdsForDirectReplies.length
        ? prisma.post.groupBy({
            by: ["parentId"],
            where: {
              parentId: { in: postIdsForDirectReplies },
              isHidden: false,
              isDeleted: false,
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const directPostCountByThreadId = new Map(
      directPostRows.map((row) => [row.threadId, row._count._all])
    );
    const directReplyCountByPostId = new Map(
      directReplyRows
        .filter((row) => typeof row.parentId === "number")
        .map((row) => [row.parentId, row._count._all])
    );

    const favoriteTeamMatchesWithoutThreadEvent = favoriteTeamMatches.filter(
      (match) => !matchIdsWithThreadEvents.has(match.id)
    );

    const events = [
      ...followedThreads.map((thread) =>
        eventFromFollowedThread(thread, directPostCountByThreadId.get(thread.id) || 0)
      ),
      ...followedPosts.map((post) =>
        eventFromFollowedPost(post, directReplyCountByPostId.get(post.id) || 0)
      ),
      ...repliesToMyPosts.map((post) =>
        eventFromReplyToMyPost(post, directReplyCountByPostId.get(post.id) || 0)
      ),
      ...postsInMyThreads.map((post) =>
        eventFromPostInMyThread(post, directReplyCountByPostId.get(post.id) || 0)
      ),
      ...newFollowers.map((follow) => eventFromNewFollower(follow)),
      ...(favoriteTeamId
        ? favoriteTeamMatchesWithoutThreadEvent.map((match) =>
            eventFromFavoriteTeamMatch(match, favoriteTeamId)
          )
        : []),
      ...favoriteTeamThreads.map((thread) =>
        eventFromFavoriteTeamThread(thread, directPostCountByThreadId.get(thread.id) || 0)
      ),
      ...favoriteTeamMatchThreads.map((thread) =>
        eventFromFavoriteTeamMatchThread(thread, directPostCountByThreadId.get(thread.id) || 0)
      ),
    ];

    const uniqueEventById = new Map(events.map((event) => [event.id, event]));
    const mergedEvents = Array.from(uniqueEventById.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const pagedEvents = mergedEvents.slice(skip, skip + limit);

    return NextResponse.json({
      items: pagedEvents,
      total: mergedEvents.length,
      page,
      limit,
      totalPages: Math.ceil(mergedEvents.length / limit),
      since: since.toISOString(),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
