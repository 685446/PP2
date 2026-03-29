import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SYSTEM_USER_EMAIL = process.env.SYSTEM_USER_EMAIL || "system@sportsdeck.com";
const SYSTEM_USER_USERNAME = process.env.SYSTEM_USER_USERNAME || "SportsDeck Bot";
const SYSTEM_USER_AVATAR =
  process.env.SYSTEM_USER_AVATAR || "/branding/logo_full_color_notext.png";
const SYSTEM_USER_BIO =
  "Automated account for match threads and moderation actions";
const seededThreadCreatedAt = new Map<number, Date>();
const threadActivityOffsets = new Map<number, number>();

function recentDate(daysAgo: number, hour: number, minute = 0) {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function futureDate(daysAhead: number, hour: number, minute = 0) {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + daysAhead);
  return date;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function avatarForIndex(index: number) {
  return `/avatars/default${(index % 6) + 1}.png`;
}

function compactThreadLabel(title: string) {
  return title
    .replace(/[^a-z0-9 ]/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .toLowerCase();
}

function nextPostTimestamp(threadId: number) {
  const base = seededThreadCreatedAt.get(threadId) ?? recentDate(7, 12, 0);
  const index = threadActivityOffsets.get(threadId) ?? 0;
  const spacingMinutes = 17 + (threadId % 5) * 4;
  const createdAt = addMinutes(base, 25 + index * spacingMinutes);
  threadActivityOffsets.set(threadId, index + 1);
  return createdAt;
}

async function ensurePost(data: {
  content: string;
  threadId: number;
  authorId: number;
  parentId?: number | null;
  createdAt?: Date;
}) {
  const createdAt = data.createdAt ?? nextPostTimestamp(data.threadId);
  const existing = await prisma.post.findFirst({
    where: {
      content: data.content,
      threadId: data.threadId,
      authorId: data.authorId,
      parentId: data.parentId ?? null,
    },
  });

  if (existing) {
    return prisma.post.update({
      where: { id: existing.id },
      data: { createdAt },
    });
  }

  return prisma.post.create({
    data: {
      content: data.content,
      threadId: data.threadId,
      authorId: data.authorId,
      parentId: data.parentId ?? null,
      createdAt,
    },
  });
}

async function ensureEditedPost(data: {
  originalContent: string;
  content: string;
  threadId: number;
  authorId: number;
  parentId?: number | null;
  createdAt?: Date;
  editHistory?: Array<{
    content: string;
    editedAt: Date;
  }>;
}) {
  const createdAt = data.createdAt ?? nextPostTimestamp(data.threadId);
  const knownContents = Array.from(
    new Set([
      data.originalContent,
      data.content,
      ...(data.editHistory?.map((entry) => entry.content) ?? []),
    ])
  );

  const existing = await prisma.post.findFirst({
    where: {
      threadId: data.threadId,
      authorId: data.authorId,
      parentId: data.parentId ?? null,
      OR: knownContents.map((content) => ({ content })),
    },
  });

  const post = existing
    ? await prisma.post.update({
        where: { id: existing.id },
        data: {
          content: data.content,
          createdAt,
        },
      })
    : await prisma.post.create({
        data: {
          content: data.content,
          threadId: data.threadId,
          authorId: data.authorId,
          parentId: data.parentId ?? null,
          createdAt,
        },
      });

  for (const edit of data.editHistory ?? []) {
    const existingEdit = await prisma.postEdit.findFirst({
      where: {
        postId: post.id,
        content: edit.content,
      },
    });

    if (existingEdit) {
      await prisma.postEdit.update({
        where: { id: existingEdit.id },
        data: { editedAt: edit.editedAt },
      });
      continue;
    }

    await prisma.postEdit.create({
      data: {
        postId: post.id,
        content: edit.content,
        editedAt: edit.editedAt,
      },
    });
  }

  return post;
}

async function resolveForumTeam(data: {
  name: string;
  shortName: string;
}) {
  return prisma.team.findFirst({
    where: {
      OR: [{ name: data.name }, { shortName: data.shortName }],
    },
  });
}

async function ensureThread(data: {
  title: string;
  body: string;
  type: "GENERAL" | "TEAM";
  authorId: number;
  openAt: Date;
  createdAt?: Date;
  teamId?: number | null;
  tagNames: string[];
}, tagMap: Record<string, { id: number }>) {
  const createdAt = data.createdAt ?? data.openAt;
  const existing = await prisma.thread.findFirst({
    where: {
      title: data.title,
      type: data.type,
      teamId: data.type === "TEAM" ? data.teamId ?? null : null,
    },
  });

  if (existing) {
    const thread = await prisma.thread.update({
      where: { id: existing.id },
      data: {
        body: data.body,
        authorId: data.authorId,
        teamId: data.type === "TEAM" ? data.teamId ?? null : null,
        openAt: data.openAt,
        createdAt,
      },
    });
    seededThreadCreatedAt.set(thread.id, createdAt);
    return thread;
  }

  const thread = await prisma.thread.create({
    data: {
      title: data.title,
      body: data.body,
      type: data.type,
      authorId: data.authorId,
      teamId: data.type === "TEAM" ? data.teamId ?? null : null,
      openAt: data.openAt,
      createdAt,
      tags: {
        create: data.tagNames.map((tagName) => ({
          tagId: tagMap[tagName].id,
        })),
      },
    },
  });
  seededThreadCreatedAt.set(thread.id, createdAt);
  return thread;
}

async function ensurePoll(data: {
  threadId: number;
  authorId: number;
  question: string;
  deadline: Date;
  options: string[];
}) {
  const existing = await prisma.poll.findUnique({
    where: { threadId: data.threadId },
    include: {
      options: true,
    },
  });

  const poll = existing
    ? await prisma.poll.update({
        where: { id: existing.id },
        data: {
          authorId: data.authorId,
          question: data.question,
          deadline: data.deadline,
        },
        include: {
          options: true,
        },
      })
    : await prisma.poll.create({
        data: {
          threadId: data.threadId,
          authorId: data.authorId,
          question: data.question,
          deadline: data.deadline,
        },
        include: {
          options: true,
        },
      });

  const optionMap = new Map(poll.options.map((option) => [option.text, option]));

  for (const optionText of data.options) {
    const trimmed = optionText.trim();
    if (!trimmed || optionMap.has(trimmed)) continue;

    const option = await prisma.pollOption.create({
      data: {
        pollId: poll.id,
        text: trimmed,
      },
    });
    optionMap.set(trimmed, option);
  }

  return {
    poll,
    options: data.options
      .map((optionText) => optionMap.get(optionText.trim()))
      .filter((option): option is NonNullable<typeof option> => Boolean(option)),
  };
}

async function ensurePollVote(data: {
  userId: number;
  pollOptionId: number;
}) {
  return prisma.pollVote.upsert({
    where: {
      userId_pollOptionId: {
        userId: data.userId,
        pollOptionId: data.pollOptionId,
      },
    },
    update: {},
    create: {
      userId: data.userId,
      pollOptionId: data.pollOptionId,
    },
  });
}

async function ensureFollow(data: {
  followerId: number;
  followingId: number;
  createdAt: Date;
}) {
  return prisma.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: data.followerId,
        followingId: data.followingId,
      },
    },
    update: {
      createdAt: data.createdAt,
    },
    create: {
      followerId: data.followerId,
      followingId: data.followingId,
      createdAt: data.createdAt,
    },
  });
}

async function ensureAppeal(data: {
  userId: number;
  reason: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
}) {
  const existing = await prisma.appeal.findFirst({
    where: {
      userId: data.userId,
      reason: data.reason,
    },
  });

  if (existing) {
    return prisma.appeal.update({
      where: { id: existing.id },
      data: {
        status: data.status ?? "PENDING",
        createdAt: data.createdAt,
      },
    });
  }

  return prisma.appeal.create({
    data: {
      userId: data.userId,
      reason: data.reason,
      status: data.status ?? "PENDING",
      createdAt: data.createdAt,
    },
  });
}

async function ensureUserReport(data: {
  reporterId: number;
  reportedUserId: number;
  reason: string;
  status?: "PENDING" | "APPROVED" | "DISMISSED";
  createdAt: Date;
}) {
  const existing = await prisma.report.findFirst({
    where: {
      reporterId: data.reporterId,
      targetType: "USER",
      reportedUserId: data.reportedUserId,
      reason: data.reason,
    },
  });

  if (existing) {
    return prisma.report.update({
      where: { id: existing.id },
      data: {
        status: data.status ?? "PENDING",
        createdAt: data.createdAt,
      },
    });
  }

  return prisma.report.create({
    data: {
      reporterId: data.reporterId,
      targetType: "USER",
      reportedUserId: data.reportedUserId,
      reason: data.reason,
      status: data.status ?? "PENDING",
      createdAt: data.createdAt,
    },
  });
}

async function main() {
  console.log("Seeding database...");

  // ─── Users ───────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("password123", 10);
  const adminHash = await bcrypt.hash("admin123", 10);
  const joinedAt = {
    admin: recentDate(240, 9, 10),
    system: recentDate(225, 8, 25),
    harry: recentDate(190, 20, 5),
    emily: recentDate(176, 18, 40),
    james: recentDate(164, 21, 15),
    sara: recentDate(151, 19, 50),
    mike: recentDate(138, 22, 20),
    lena: recentDate(126, 17, 35),
    tom: recentDate(114, 20, 45),
    aisha: recentDate(102, 18, 5),
    nina: recentDate(58, 19, 25),
    omar: recentDate(46, 20, 40),
    priya: recentDate(34, 18, 15),
    leo: recentDate(24, 21, 10),
    maya: recentDate(17, 19, 55),
    noah: recentDate(9, 20, 30),
  };

  const admin = await prisma.user.upsert({
    where: { email: "admin@sportsdeck.com" },
    update: {
      createdAt: joinedAt.admin,
    },
    create: {
      email: "admin@sportsdeck.com",
      username: "admin",
      passwordHash: adminHash,
      role: "ADMIN",
      status: "ACTIVE",
      avatar: "/avatars/default1.png",
      createdAt: joinedAt.admin,
    },
  });

  await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {
      username: SYSTEM_USER_USERNAME,
      avatar: SYSTEM_USER_AVATAR,
      status: "ACTIVE",
      createdAt: joinedAt.system,
    },
    create: {
      email: SYSTEM_USER_EMAIL,
      username: SYSTEM_USER_USERNAME,
      passwordHash,
      role: "USER",
      status: "ACTIVE",
      avatar: SYSTEM_USER_AVATAR,
      createdAt: joinedAt.system,
    },
  });

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "harry@sportsdeck.com" },
      update: {
        createdAt: joinedAt.harry,
      },
      create: {
        email: "harry@sportsdeck.com",
        username: "HarryKane9",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default2.png",
        createdAt: joinedAt.harry,
      },
    }),
    prisma.user.upsert({
      where: { email: "emily@sportsdeck.com" },
      update: {
        createdAt: joinedAt.emily,
      },
      create: {
        email: "emily@sportsdeck.com",
        username: "EmilyFC",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default3.png",
        createdAt: joinedAt.emily,
      },
    }),
    prisma.user.upsert({
      where: { email: "james@sportsdeck.com" },
      update: {
        createdAt: joinedAt.james,
      },
      create: {
        email: "james@sportsdeck.com",
        username: "JamesPL",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default4.png",
        createdAt: joinedAt.james,
      },
    }),
    prisma.user.upsert({
      where: { email: "sara@sportsdeck.com" },
      update: {
        createdAt: joinedAt.sara,
      },
      create: {
        email: "sara@sportsdeck.com",
        username: "SaraGooner",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default5.png",
        createdAt: joinedAt.sara,
      },
    }),
    prisma.user.upsert({
      where: { email: "mike@sportsdeck.com" },
      update: {
        createdAt: joinedAt.mike,
      },
      create: {
        email: "mike@sportsdeck.com",
        username: "MikeRed",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default6.png",
        createdAt: joinedAt.mike,
      },
    }),
    prisma.user.upsert({
      where: { email: "lena@sportsdeck.com" },
      update: {
        createdAt: joinedAt.lena,
      },
      create: {
        email: "lena@sportsdeck.com",
        username: "LenaBlues",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default1.png",
        createdAt: joinedAt.lena,
      },
    }),
    prisma.user.upsert({
      where: { email: "tom@sportsdeck.com" },
      update: {
        createdAt: joinedAt.tom,
      },
      create: {
        email: "tom@sportsdeck.com",
        username: "TomSpurs",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default2.png",
        createdAt: joinedAt.tom,
      },
    }),
    prisma.user.upsert({
      where: { email: "aisha@sportsdeck.com" },
      update: {
        createdAt: joinedAt.aisha,
      },
      create: {
        email: "aisha@sportsdeck.com",
        username: "AishaCity",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default3.png",
        createdAt: joinedAt.aisha,
      },
    }),
    prisma.user.upsert({
      where: { email: "nina@sportsdeck.com" },
      update: {
        createdAt: joinedAt.nina,
      },
      create: {
        email: "nina@sportsdeck.com",
        username: "NinaNorthBank",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default4.png",
        createdAt: joinedAt.nina,
      },
    }),
    prisma.user.upsert({
      where: { email: "omar@sportsdeck.com" },
      update: {
        createdAt: joinedAt.omar,
      },
      create: {
        email: "omar@sportsdeck.com",
        username: "OmarPress",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default5.png",
        createdAt: joinedAt.omar,
      },
    }),
    prisma.user.upsert({
      where: { email: "priya@sportsdeck.com" },
      update: {
        createdAt: joinedAt.priya,
      },
      create: {
        email: "priya@sportsdeck.com",
        username: "PriyaAwayDays",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default6.png",
        createdAt: joinedAt.priya,
      },
    }),
    prisma.user.upsert({
      where: { email: "leo@sportsdeck.com" },
      update: {
        createdAt: joinedAt.leo,
      },
      create: {
        email: "leo@sportsdeck.com",
        username: "LeoTempo",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default1.png",
        createdAt: joinedAt.leo,
      },
    }),
    prisma.user.upsert({
      where: { email: "maya@sportsdeck.com" },
      update: {
        createdAt: joinedAt.maya,
      },
      create: {
        email: "maya@sportsdeck.com",
        username: "MayaCounter",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default2.png",
        createdAt: joinedAt.maya,
      },
    }),
    prisma.user.upsert({
      where: { email: "noah@sportsdeck.com" },
      update: {
        createdAt: joinedAt.noah,
      },
      create: {
        email: "noah@sportsdeck.com",
        username: "NoahUnderlap",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
        avatar: "/avatars/default3.png",
        createdAt: joinedAt.noah,
      },
    }),
  ]);

  console.log(`Ensured ${users.length + 2} base users`);
  console.log(`System bot profile: ${SYSTEM_USER_USERNAME} — ${SYSTEM_USER_BIO}`);

  // ─── Tags ────────────────────────────────────────────────────────────────
  const tagNames = [
    "transfers",
    "tactics",
    "matchday",
    "injury",
    "premier-league",
    "top4",
    "relegation",
    "champions-league",
    "manager",
    "fixtures",
    "youth",
    "defence",
    "summer-window",
    "underrated",
  ];

  const tags = await Promise.all(
    tagNames.map((name) =>
      prisma.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    )
  );

  const tagMap = Object.fromEntries(tags.map((t) => [t.name, t]));

  console.log(`Ensured ${tags.length} tags`);

  const forumTeams = await Promise.all([
    resolveForumTeam({
      name: "Arsenal FC",
      shortName: "Arsenal",
    }),
    resolveForumTeam({
      name: "Liverpool FC",
      shortName: "Liverpool",
    }),
    resolveForumTeam({
      name: "Chelsea FC",
      shortName: "Chelsea",
    }),
    resolveForumTeam({
      name: "Tottenham Hotspur FC",
      shortName: "Spurs",
    }),
    resolveForumTeam({
      name: "Manchester City FC",
      shortName: "Man City",
    }),
    resolveForumTeam({
      name: "Newcastle United FC",
      shortName: "Newcastle",
    }),
  ]);

  const teamMap = Object.fromEntries(
    forumTeams
      .filter((team): team is NonNullable<typeof team> => Boolean(team))
      .map((team) => [team.name, team])
  );
  const allTeams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      shortName: true,
    },
    orderBy: { id: "asc" },
  });
  const favoriteTeamIds = allTeams.map((team) => team.id);
  console.log(`Resolved ${Object.keys(teamMap).length} synced teams for demo team threads`);

  if (favoriteTeamIds.length > 0) {
    const namedFavoriteTeamIds = [
      teamMap["Tottenham Hotspur FC"]?.id ?? favoriteTeamIds[0],
      teamMap["Liverpool FC"]?.id ?? favoriteTeamIds[1 % favoriteTeamIds.length],
      teamMap["Chelsea FC"]?.id ?? favoriteTeamIds[2 % favoriteTeamIds.length],
      teamMap["Arsenal FC"]?.id ?? favoriteTeamIds[3 % favoriteTeamIds.length],
      teamMap["Liverpool FC"]?.id ?? favoriteTeamIds[4 % favoriteTeamIds.length],
      teamMap["Chelsea FC"]?.id ?? favoriteTeamIds[5 % favoriteTeamIds.length],
      teamMap["Tottenham Hotspur FC"]?.id ?? favoriteTeamIds[0],
      teamMap["Manchester City FC"]?.id ?? favoriteTeamIds[1 % favoriteTeamIds.length],
      teamMap["Arsenal FC"]?.id ?? favoriteTeamIds[2 % favoriteTeamIds.length],
      teamMap["Liverpool FC"]?.id ?? favoriteTeamIds[3 % favoriteTeamIds.length],
      teamMap["Newcastle United FC"]?.id ?? favoriteTeamIds[4 % favoriteTeamIds.length],
      teamMap["Manchester City FC"]?.id ?? favoriteTeamIds[5 % favoriteTeamIds.length],
      teamMap["Arsenal FC"]?.id ?? favoriteTeamIds[0],
      teamMap["Liverpool FC"]?.id ?? favoriteTeamIds[1 % favoriteTeamIds.length],
    ];

    await Promise.all(
      users.map((user, index) =>
        prisma.user.update({
          where: { id: user.id },
          data: {
            favoriteTeamId: namedFavoriteTeamIds[index % namedFavoriteTeamIds.length] ?? null,
          },
        })
      )
    );

    const supporterPrefixes = [
      "North",
      "South",
      "East",
      "West",
      "Rapid",
      "Calm",
      "Sharp",
      "Loud",
      "Bright",
      "Swift",
      "True",
      "Bold",
    ];
    const supporterSuffixes = [
      "Press",
      "Pivot",
      "Volley",
      "Terrace",
      "Tackle",
      "Tempo",
      "Cross",
    ];

    const generatedUsers = await Promise.all(
      supporterPrefixes.flatMap((prefix, prefixIndex) =>
        supporterSuffixes.map((suffix, suffixIndex) => {
          const index = prefixIndex * supporterSuffixes.length + suffixIndex;
          const tag = String(index + 1).padStart(2, "0");
          const mostlyRecentDaysAgo =
            index < 60 ? index % 14 : 14 + ((index - 60) % 46) + 1;
          const createdAt = recentDate(
            mostlyRecentDaysAgo,
            9 + (index % 11),
            (index * 7) % 60
          );

          return prisma.user.upsert({
            where: { email: `supporter${tag}@sportsdeck.com` },
            update: {
              createdAt,
              favoriteTeamId: favoriteTeamIds[index % favoriteTeamIds.length] ?? null,
            },
            create: {
              email: `supporter${tag}@sportsdeck.com`,
              username: `${prefix}${suffix}${tag}`,
              passwordHash,
              role: "USER",
              status: "ACTIVE",
              avatar: avatarForIndex(index),
              favoriteTeamId: favoriteTeamIds[index % favoriteTeamIds.length] ?? null,
              createdAt,
            },
          });
        })
      )
    );

    users.push(...generatedUsers);
  }

  if (favoriteTeamIds.length > 0) {
    await Promise.all([
      prisma.user.update({
        where: { email: "supporter07@sportsdeck.com" },
        data: {
          status: "SUSPENDED",
          statusReason: "Repeated spam reports from multiple communities.",
          suspendedUntil: futureDate(14, 18, 0),
        },
      }),
      prisma.user.update({
        where: { email: "supporter18@sportsdeck.com" },
        data: {
          status: "SUSPENDED",
          statusReason: "Harassment warnings escalated into a temporary suspension.",
          suspendedUntil: futureDate(14, 12, 30),
        },
      }),
      prisma.user.update({
        where: { email: "supporter41@sportsdeck.com" },
        data: {
          status: "SUSPENDED",
          statusReason: "Flooded match threads with duplicate promotional posts.",
          suspendedUntil: futureDate(14, 20, 15),
        },
      }),
      prisma.user.update({
        where: { email: "supporter63@sportsdeck.com" },
        data: {
          status: "BANNED",
          statusReason: "Permanent ban after repeated abusive account-level reports.",
          suspendedUntil: null,
        },
      }),
      prisma.user.update({
        where: { email: "supporter79@sportsdeck.com" },
        data: {
          status: "BANNED",
          statusReason: "Ban applied for persistent impersonation and spam behavior.",
          suspendedUntil: null,
        },
      }),
    ]);

    const appealedUsers = await prisma.user.findMany({
      where: {
        email: {
          in: [
            "supporter07@sportsdeck.com",
            "supporter18@sportsdeck.com",
            "supporter63@sportsdeck.com",
            "supporter79@sportsdeck.com",
          ],
        },
      },
      select: {
        id: true,
        email: true,
      },
    });
    const appealUserByEmail = new Map(appealedUsers.map((user) => [user.email, user.id]));
    const reportUsers = await prisma.user.findMany({
      where: {
        email: {
          in: [
            "harry@sportsdeck.com",
            "emily@sportsdeck.com",
            "james@sportsdeck.com",
            "sara@sportsdeck.com",
            "mike@sportsdeck.com",
            "lena@sportsdeck.com",
            "supporter07@sportsdeck.com",
            "supporter18@sportsdeck.com",
            "supporter41@sportsdeck.com",
            "supporter63@sportsdeck.com",
            "supporter79@sportsdeck.com",
          ],
        },
      },
      select: {
        id: true,
        email: true,
      },
    });
    const reportUserByEmail = new Map(reportUsers.map((user) => [user.email, user.id]));

    await Promise.all([
      ensureAppeal({
        userId: appealUserByEmail.get("supporter07@sportsdeck.com")!,
        reason: "I know I posted too quickly during live matches, but I have stopped and would appreciate another chance after the warning period.",
        status: "PENDING",
        createdAt: recentDate(2, 11, 10),
      }),
      ensureAppeal({
        userId: appealUserByEmail.get("supporter18@sportsdeck.com")!,
        reason: "The suspension is fair, but I am appealing to explain the argument came from one heated thread and not repeated targeting.",
        status: "PENDING",
        createdAt: recentDate(1, 16, 20),
      }),
      ensureAppeal({
        userId: appealUserByEmail.get("supporter63@sportsdeck.com")!,
        reason: "I understand the account was banned, but I am asking for a review because I was using a parody account and not trying to impersonate anyone maliciously.",
        status: "REJECTED",
        createdAt: recentDate(11, 13, 45),
      }),
      ensureAppeal({
        userId: appealUserByEmail.get("supporter79@sportsdeck.com")!,
        reason: "I accept the spam findings and would be willing to return under stricter limits if the ban can be reconsidered.",
        status: "PENDING",
        createdAt: recentDate(3, 10, 35),
      }),
      ensureUserReport({
        reporterId: reportUserByEmail.get("harry@sportsdeck.com")!,
        reportedUserId: reportUserByEmail.get("supporter07@sportsdeck.com")!,
        reason: "Repeated spammy comments across multiple live match threads.",
        status: "PENDING",
        createdAt: recentDate(6, 21, 5),
      }),
      ensureUserReport({
        reporterId: reportUserByEmail.get("emily@sportsdeck.com")!,
        reportedUserId: reportUserByEmail.get("supporter18@sportsdeck.com")!,
        reason: "Escalated into direct harassment after a disagreement in a team thread.",
        status: "PENDING",
        createdAt: recentDate(4, 18, 15),
      }),
      ensureUserReport({
        reporterId: reportUserByEmail.get("james@sportsdeck.com")!,
        reportedUserId: reportUserByEmail.get("supporter41@sportsdeck.com")!,
        reason: "Flooded the forum with duplicate promotional replies during the weekend fixtures.",
        status: "PENDING",
        createdAt: recentDate(2, 20, 20),
      }),
      ensureUserReport({
        reporterId: reportUserByEmail.get("sara@sportsdeck.com")!,
        reportedUserId: reportUserByEmail.get("supporter63@sportsdeck.com")!,
        reason: "Account kept impersonating club staff and doubling down after warnings.",
        status: "APPROVED",
        createdAt: recentDate(13, 14, 40),
      }),
      ensureUserReport({
        reporterId: reportUserByEmail.get("mike@sportsdeck.com")!,
        reportedUserId: reportUserByEmail.get("supporter79@sportsdeck.com")!,
        reason: "Persistent spam behavior and suspicious copy-paste posts in several communities.",
        status: "APPROVED",
        createdAt: recentDate(9, 19, 55),
      }),
      ensureUserReport({
        reporterId: reportUserByEmail.get("lena@sportsdeck.com")!,
        reportedUserId: reportUserByEmail.get("supporter18@sportsdeck.com")!,
        reason: "Kept returning to the same user with targeted replies after being asked to stop.",
        status: "PENDING",
        createdAt: recentDate(1, 11, 45),
      }),
    ]);
  }

  console.log(`Expanded seeded users to ${users.length + 2} total accounts`);
  const threadTimeline = {
    seasonDiscussion: recentDate(31, 20, 10),
    januaryWindow: recentDate(28, 18, 55),
    titleRace: recentDate(25, 21, 15),
    relegationBattle: recentDate(23, 19, 5),
    bestXi: recentDate(21, 20, 35),
    managerPressure: recentDate(18, 18, 20),
    topFiveRace: recentDate(16, 21, 45),
    weekendWatchlist: recentDate(13, 17, 30),
    youngPlayer: recentDate(11, 20, 0),
    defensiveStructure: recentDate(9, 19, 20),
    summerWishList: recentDate(6, 18, 15),
    underratedSigning: recentDate(5, 21, 10),
    atmosphere: recentDate(4, 19, 40),
    congestion: recentDate(4, 21, 25),
    midTableLeap: recentDate(3, 18, 50),
    setPiece: recentDate(3, 20, 35),
    deadlineDay: recentDate(2, 19, 10),
    changedOpinion: recentDate(2, 21, 5),
    arsenalCorner: recentDate(3, 19, 5),
    liverpoolCorner: recentDate(3, 19, 35),
    chelseaCorner: recentDate(3, 20, 5),
    spursCorner: recentDate(3, 20, 40),
    cityCorner: recentDate(3, 21, 10),
    newcastleCorner: recentDate(3, 21, 35),
    midfieldTrio: recentDate(1, 18, 45),
    squadPlayer: recentDate(1, 20, 20),
    panicMeter: recentDate(14, 20, 15),
    rewatchMatch: recentDate(12, 19, 35),
    awayDay: recentDate(10, 21, 5),
    improvedPlayer: recentDate(8, 18, 50),
    identity: recentDate(5, 20, 25),
    finalDayHero: recentDate(2, 18, 40),
  };

  // ─── Threads ─────────────────────────────────────────────────────────────
  const thread1 = await prisma.thread.upsert({
    where: { id: 1 },
    update: {
      createdAt: threadTimeline.seasonDiscussion,
    },
    create: {
      title: "Premier League 2024/25 Season Discussion",
      body: "Welcome to the general discussion thread for the 2024/25 Premier League season! Share your thoughts, predictions, and reactions here.",
      type: "GENERAL",
      authorId: admin.id,
      openAt: new Date("2024-08-01"),
      createdAt: threadTimeline.seasonDiscussion,
      tags: {
        create: [
          { tagId: tagMap["premier-league"].id },
          { tagId: tagMap["matchday"].id },
        ],
      },
    },
  });

  const thread2 = await prisma.thread.upsert({
    where: { id: 2 },
    update: {
      createdAt: threadTimeline.januaryWindow,
    },
    create: {
      title: "January Transfer Window 2025 - Rumours & Confirmed Deals",
      body: "Keep track of all the latest transfer news, rumours, and confirmed deals from the January 2025 window.",
      type: "GENERAL",
      authorId: users[0].id,
      openAt: new Date("2025-01-01"),
      createdAt: threadTimeline.januaryWindow,
      tags: {
        create: [{ tagId: tagMap["transfers"].id }],
      },
    },
  });

  const thread3 = await prisma.thread.upsert({
    where: { id: 3 },
    update: {
      createdAt: threadTimeline.titleRace,
    },
    create: {
      title: "Who will win the title this season?",
      body: "With the season well underway, who do you think will lift the Premier League trophy? Cast your vote and share your reasoning!",
      type: "GENERAL",
      authorId: users[1].id,
      openAt: new Date("2024-09-01"),
      createdAt: threadTimeline.titleRace,
      tags: {
        create: [
          { tagId: tagMap["top4"].id },
          { tagId: tagMap["premier-league"].id },
        ],
      },
    },
  });

  const thread4 = await prisma.thread.upsert({
    where: { id: 4 },
    update: {
      createdAt: threadTimeline.relegationBattle,
    },
    create: {
      title: "Relegation Battle 2024/25 — Who Goes Down?",
      body: "The relegation zone is getting tight. Which three teams do you think will drop to the Championship this season?",
      type: "GENERAL",
      authorId: users[2].id,
      openAt: new Date("2024-10-01"),
      createdAt: threadTimeline.relegationBattle,
      tags: {
        create: [{ tagId: tagMap["relegation"].id }],
      },
    },
  });

  const thread5 = await prisma.thread.upsert({
    where: { id: 5 },
    update: {
      createdAt: threadTimeline.bestXi,
    },
    create: {
      title: "Best XI of the Season So Far",
      body: "Who would make your Premier League best XI based on performances this season? Drop your team in the comments!",
      type: "GENERAL",
      authorId: users[3].id,
      openAt: new Date("2025-01-15"),
      createdAt: threadTimeline.bestXi,
      tags: {
        create: [
          { tagId: tagMap["tactics"].id },
          { tagId: tagMap["premier-league"].id },
        ],
      },
    },
  });

  const thread6 = await prisma.thread.upsert({
    where: { id: 6 },
    update: {
      createdAt: threadTimeline.managerPressure,
    },
    create: {
      title: "Manager Pressure Index: Who's Under the Most Heat?",
      body: "A rough run of fixtures can change the mood around a club fast. Which manager is under the most pressure right now, and who still deserves patience?",
      type: "GENERAL",
      authorId: users[4].id,
      openAt: new Date("2025-02-01"),
      createdAt: threadTimeline.managerPressure,
      tags: {
        create: [
          { tagId: tagMap["manager"].id },
          { tagId: tagMap["premier-league"].id },
        ],
      },
    },
  });

  const thread7 = await prisma.thread.upsert({
    where: { id: 7 },
    update: {
      createdAt: threadTimeline.topFiveRace,
    },
    create: {
      title: "Top Five Race: Who Grabs the Final Champions League Spots?",
      body: "With the table tightening up, which clubs do you trust most in the race for the Champions League places? Form, depth, and schedule all matter now.",
      type: "GENERAL",
      authorId: users[6].id,
      openAt: new Date("2025-02-15"),
      createdAt: threadTimeline.topFiveRace,
      tags: {
        create: [
          { tagId: tagMap["top4"].id },
          { tagId: tagMap["champions-league"].id },
        ],
      },
    },
  });

  const thread8 = await prisma.thread.upsert({
    where: { id: 8 },
    update: {
      createdAt: threadTimeline.weekendWatchlist,
    },
    create: {
      title: "Weekend Watchlist: Which Fixtures Are You Building Plans Around?",
      body: "Some matchdays are ordinary and some feel loaded from the first kickoff. Which fixtures this weekend are must-watch, and what storylines are you following most closely?",
      type: "GENERAL",
      authorId: users[7].id,
      openAt: new Date("2025-03-01"),
      createdAt: threadTimeline.weekendWatchlist,
      tags: {
        create: [
          { tagId: tagMap["fixtures"].id },
          { tagId: tagMap["matchday"].id },
        ],
      },
    },
  });

  const thread9 = await prisma.thread.upsert({
    where: { id: 9 },
    update: {
      createdAt: threadTimeline.youngPlayer,
    },
    create: {
      title: "Best Young Player in the League Right Now?",
      body: "Forget potential for a second and focus on current level. Which young player is already changing games every week, and who still looks ready for a breakout?",
      type: "GENERAL",
      authorId: users[5].id,
      openAt: new Date("2025-03-10"),
      createdAt: threadTimeline.youngPlayer,
      tags: {
        create: [
          { tagId: tagMap["youth"].id },
          { tagId: tagMap["premier-league"].id },
        ],
      },
    },
  });

  const thread10 = await prisma.thread.upsert({
    where: { id: 10 },
    update: {
      createdAt: threadTimeline.defensiveStructure,
    },
    create: {
      title: "Defensive Structure or Low Block Misery? Let's Talk Tactics",
      body: "When does compact defending become a smart tactical plan, and when does it just turn into ninety minutes of surrender? Share the defensive setups you actually enjoy watching.",
      type: "GENERAL",
      authorId: users[2].id,
      openAt: new Date("2025-03-20"),
      createdAt: threadTimeline.defensiveStructure,
      tags: {
        create: [
          { tagId: tagMap["tactics"].id },
          { tagId: tagMap["defence"].id },
        ],
      },
    },
  });

  const thread11 = await prisma.thread.upsert({
    where: { id: 11 },
    update: {
      createdAt: threadTimeline.summerWishList,
    },
    create: {
      title: "Your Club's Summer Window Wish List",
      body: "If your club could only make three moves this summer, what would they be? Positions, profiles, and realistic targets all count.",
      type: "GENERAL",
      authorId: users[0].id,
      openAt: new Date("2025-04-01"),
      createdAt: threadTimeline.summerWishList,
      tags: {
        create: [
          { tagId: tagMap["transfers"].id },
          { tagId: tagMap["summer-window"].id },
        ],
      },
    },
  });

  const thread12 = await prisma.thread.upsert({
    where: { id: 12 },
    update: {
      createdAt: threadTimeline.underratedSigning,
    },
    create: {
      title: "Most Underrated Signing of the Season",
      body: "Not the biggest headline deal, not the flashiest name. Which signing has quietly transformed a side without getting the attention they deserve?",
      type: "GENERAL",
      authorId: users[1].id,
      openAt: new Date("2025-04-10"),
      createdAt: threadTimeline.underratedSigning,
      tags: {
        create: [
          { tagId: tagMap["underrated"].id },
          { tagId: tagMap["premier-league"].id },
        ],
      },
    },
  });

  const extraGeneralThreads = await Promise.all([
    ensureThread(
      {
        title: "Best Atmosphere in the League Right Now?",
        body: "Which ground feels genuinely electric this season? Think noise, tension, away-end chaos, and whether the big moments actually feel bigger there.",
        type: "GENERAL",
        authorId: users[6].id,
        openAt: new Date("2025-04-15"),
        createdAt: threadTimeline.atmosphere,
        tagNames: ["premier-league", "matchday"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Fixture Congestion: Rotate or Risk It?",
        body: "Once clubs hit the two-games-a-week stretch, what matters more: rhythm or freshness? Which manager handles congestion best, and who always looks one decision late?",
        type: "GENERAL",
        authorId: users[2].id,
        openAt: new Date("2025-04-18"),
        createdAt: threadTimeline.congestion,
        tagNames: ["fixtures", "tactics"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Which Mid-Table Side Is One Summer Away?",
        body: "Some clubs feel one smart window away from making the leap. Who has the structure, coaching, and core talent to break into the top-six conversation next year?",
        type: "GENERAL",
        authorId: users[4].id,
        openAt: new Date("2025-04-21"),
        createdAt: threadTimeline.midTableLeap,
        tagNames: ["summer-window", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Who Has the Best Set-Piece Coaching in the League?",
        body: "Dead-ball work can swing entire seasons now. Which clubs look the most rehearsed from corners, free kicks, and long throws, and who still wastes too many good situations?",
        type: "GENERAL",
        authorId: users[5].id,
        openAt: new Date("2025-04-24"),
        createdAt: threadTimeline.setPiece,
        tagNames: ["tactics", "defence"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Deadline Day Dreams and Disaster Scenarios",
        body: "What is your ideal final 24 hours of the window, and what outcome would send your fanbase into instant meltdown? Be realistic if you can, delusional if you must.",
        type: "GENERAL",
        authorId: users[7].id,
        openAt: new Date("2025-04-27"),
        createdAt: threadTimeline.deadlineDay,
        tagNames: ["transfers", "summer-window"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Which Match This Season Changed Your Opinion Most?",
        body: "Everybody has one result that forced a rethink. Which performance made you completely reassess a team, player, or manager this season?",
        type: "GENERAL",
        authorId: users[0].id,
        openAt: new Date("2025-04-30"),
        createdAt: threadTimeline.changedOpinion,
        tagNames: ["matchday", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Which Midfield Trio Would You Pay to Watch Every Week?",
        body: "Forget balance for a second and go full entertainment. Which current midfield trio would you happily watch every single weekend, even if they were not your club?",
        type: "GENERAL",
        authorId: users[1].id,
        openAt: new Date("2025-05-02"),
        createdAt: threadTimeline.midfieldTrio,
        tagNames: ["tactics", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Best Squad Player in the League?",
        body: "Not the superstar, not the first name on the team sheet. Who is the best squad player to have around when a season gets messy and depth starts deciding everything?",
        type: "GENERAL",
        authorId: users[4].id,
        openAt: new Date("2025-05-04"),
        createdAt: threadTimeline.squadPlayer,
        tagNames: ["underrated", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Run-In Panic Meter: Which Top Team Blinks First?",
        body: "Every title race has the week where legs go heavy and confidence starts wobbling. Which contender looks most likely to blink first in the run-in, and who still looks ice-cold?",
        type: "GENERAL",
        authorId: users[8].id,
        openAt: new Date("2026-03-15"),
        createdAt: threadTimeline.panicMeter,
        tagNames: ["top4", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "One Match From This Month You'd Rewatch Tonight",
        body: "Not necessarily the best match on paper. Which game from this month had enough chaos, quality, or drama that you would happily watch the whole thing again tonight?",
        type: "GENERAL",
        authorId: users[9].id,
        openAt: new Date("2026-03-17"),
        createdAt: threadTimeline.rewatchMatch,
        tagNames: ["matchday", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Best Away End in the League Right Now?",
        body: "Which travelling support is carrying the most noise this season? Ignore club size for a second and talk about the away end that keeps showing up loud regardless of scoreline.",
        type: "GENERAL",
        authorId: users[10].id,
        openAt: new Date("2026-03-19"),
        createdAt: threadTimeline.awayDay,
        tagNames: ["matchday", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Most Improved Player Since January",
        body: "Who has clearly levelled up since the turn of the year? Could be confidence, role change, fitness, or just a player finally making the league look slow.",
        type: "GENERAL",
        authorId: users[11].id,
        openAt: new Date("2026-03-21"),
        createdAt: threadTimeline.improvedPlayer,
        tagNames: ["premier-league", "underrated"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Which Club Has the Clearest Identity Right Now?",
        body: "Take trophies out of it for a second. Which club can you recognise after five minutes because the pressing, spacing, and decision-making all feel unmistakably theirs?",
        type: "GENERAL",
        authorId: users[12].id,
        openAt: new Date("2026-03-24"),
        createdAt: threadTimeline.identity,
        tagNames: ["tactics", "premier-league"],
      },
      tagMap
    ),
    ensureThread(
      {
        title: "Pick Your Last-Day Hero Before the Chaos Starts",
        body: "Who is your weirdly specific final-day hero pick? Not the obvious superstar, but the player you can already picture scoring or saving the moment when the season gets ridiculous.",
        type: "GENERAL",
        authorId: users[13].id,
        openAt: new Date("2026-03-27"),
        createdAt: threadTimeline.finalDayHero,
        tagNames: ["matchday", "top4"],
      },
      tagMap
    ),
  ]);

  const extraTeamThreadConfigs = [
    teamMap["Arsenal FC"] && {
      title: "Arsenal Supporters Corner",
      body: "Form, selection calls, title nerves, and transfer wish lists. This is the hub for Arsenal supporters to vent, celebrate, and overreact together.",
      type: "TEAM" as const,
      authorId: users[3].id,
      teamId: teamMap["Arsenal FC"].id,
      openAt: new Date("2025-04-14"),
      createdAt: threadTimeline.arsenalCorner,
      tagNames: ["transfers", "matchday"],
    },
    teamMap["Liverpool FC"] && {
      title: "Liverpool Supporters Corner",
      body: "Talk lineups, title form, pressing structure, and what still needs attention this summer. Liverpool supporters, make this your running home base.",
      type: "TEAM" as const,
      authorId: users[1].id,
      teamId: teamMap["Liverpool FC"].id,
      openAt: new Date("2025-04-14"),
      createdAt: threadTimeline.liverpoolCorner,
      tagNames: ["tactics", "matchday"],
    },
    teamMap["Chelsea FC"] && {
      title: "Chelsea Supporters Corner",
      body: "From squad balance to who actually deserves patience, this thread is for Chelsea supporters trying to make sense of the project week by week.",
      type: "TEAM" as const,
      authorId: users[5].id,
      teamId: teamMap["Chelsea FC"].id,
      openAt: new Date("2025-04-14"),
      createdAt: threadTimeline.chelseaCorner,
      tagNames: ["manager", "transfers"],
    },
    teamMap["Tottenham Hotspur FC"] && {
      title: "Spurs Supporters Corner",
      body: "Talk Ange-ball, injury frustration, recruitment needs, and whether this squad is one defender short or three. Spurs supporters, this one is yours.",
      type: "TEAM" as const,
      authorId: users[6].id,
      teamId: teamMap["Tottenham Hotspur FC"].id,
      openAt: new Date("2025-04-14"),
      createdAt: threadTimeline.spursCorner,
      tagNames: ["injury", "tactics"],
    },
    teamMap["Manchester City FC"] && {
      title: "Man City Supporters Corner",
      body: "Rotation roulette, title expectations, tactical tweaks, and all the usual stress of supporting a team everyone expects to be perfect every week.",
      type: "TEAM" as const,
      authorId: users[7].id,
      teamId: teamMap["Manchester City FC"].id,
      openAt: new Date("2025-04-14"),
      createdAt: threadTimeline.cityCorner,
      tagNames: ["tactics", "top4"],
    },
    teamMap["Newcastle United FC"] && {
      title: "Newcastle Supporters Corner",
      body: "European hopes, squad depth, and whether the current project needs patience or one more aggressive push. Newcastle supporters, jump in here.",
      type: "TEAM" as const,
      authorId: users[4].id,
      teamId: teamMap["Newcastle United FC"].id,
      openAt: new Date("2025-04-14"),
      createdAt: threadTimeline.newcastleCorner,
      tagNames: ["champions-league", "fixtures"],
    },
  ].filter(Boolean);

  const extraTeamThreads = await Promise.all(
    extraTeamThreadConfigs.map((config) => ensureThread(config, tagMap))
  );
  const generatedGeneralTopics = [
    "Pressing triggers that changed a match",
    "One tactical tweak that instantly worked",
    "The cleanest midfield balance this week",
    "Which attack looks most repeatable",
    "Overperforming teams we still believe in",
    "Underperforming sides still worth backing",
    "A lineup call you would keep making",
    "The bench option you trust most",
    "Best in-game adjustment from the weekend",
    "Who looks built for the run-in",
    "Most watchable team right now",
    "Who is quietly controlling matches",
  ];
  const generatedGeneralAngles = [
    "from the weekend",
    "heading into the run-in",
    "after this matchweek",
    "with two months left",
    "since the last international break",
    "after the latest title-race swing",
    "based on recent form",
    "before the next fixture pile-up",
    "from the last two weeks",
    "as the table tightens",
  ];
  const generatedTagSets: string[][] = [
    ["premier-league", "matchday"],
    ["tactics", "premier-league"],
    ["fixtures", "matchday"],
    ["top4", "premier-league"],
    ["underrated", "premier-league"],
    ["defence", "tactics"],
    ["manager", "premier-league"],
    ["champions-league", "top4"],
  ];

  const generatedGeneralThreads = await Promise.all(
    Array.from({ length: 120 }, (_, index) => {
      const topic = generatedGeneralTopics[index % generatedGeneralTopics.length];
      const angle = generatedGeneralAngles[Math.floor(index / generatedGeneralTopics.length) % generatedGeneralAngles.length];
      const daysAgo = index < 90 ? index % 14 : 14 + ((index - 90) % 46) + 1;
      const createdAt = recentDate(daysAgo, 9 + (index % 11), (index * 5) % 60);
      const tagNames = generatedTagSets[index % generatedTagSets.length];

      return ensureThread(
        {
          title: `${topic} ${angle}`,
          body: `Fresh thread ${index + 1}: pull apart the patterns, players, and decisions behind ${topic.toLowerCase()} ${angle}. Keep it specific to recent form and actual performances.`,
          type: "GENERAL",
          authorId: users[index % users.length].id,
          openAt: createdAt,
          createdAt,
          tagNames,
        },
        tagMap
      );
    })
  );

  const generatedTeamThreads = favoriteTeamIds.length
    ? await Promise.all(
        Array.from({ length: 70 }, (_, index) => {
          const team = allTeams[index % allTeams.length];
          const createdAt = recentDate(
            index < 50 ? index % 14 : 14 + ((index - 50) % 46) + 1,
            10 + (index % 10),
            (index * 9) % 60
          );
          const teamLabels = [
            "Weekly fan check-in",
            "Selection headache discussion",
            "Run-in confidence meter",
            "Summer needs brainstorm",
            "Three things we learned lately",
            "Who deserves more minutes",
            "What still needs fixing",
          ];
          const bodyLabels = [
            "Talk recent form, lineup decisions, and the one issue supporters keep circling back to.",
            "Keep it to the last couple of weeks: what improved, what slipped, and what still feels unresolved?",
            "Use this space for team-specific reactions, worries, and realistic optimism.",
          ];

          return ensureThread(
            {
              title: `${team.shortName || team.name} ${teamLabels[Math.floor(index / allTeams.length) % teamLabels.length]}`,
              body: `${team.name} thread ${index + 1}. ${bodyLabels[index % bodyLabels.length]}`,
              type: "TEAM",
              authorId: users[(index + 17) % users.length].id,
              teamId: team.id,
              openAt: createdAt,
              createdAt,
              tagNames: generatedTagSets[(index + 3) % generatedTagSets.length],
            },
            tagMap
          );
        })
      )
    : [];
  const threadByTitle = new Map(
    [...extraGeneralThreads, ...extraTeamThreads].map((thread) => [thread.title, thread])
  );
  const bestAtmosphereThread = threadByTitle.get("Best Atmosphere in the League Right Now?");
  const fixtureCongestionThread = threadByTitle.get("Fixture Congestion: Rotate or Risk It?");
  const midTableThread = threadByTitle.get("Which Mid-Table Side Is One Summer Away?");
  const setPieceThread = threadByTitle.get("Who Has the Best Set-Piece Coaching in the League?");
  const deadlineDayThread = threadByTitle.get("Deadline Day Dreams and Disaster Scenarios");
  const changedOpinionThread = threadByTitle.get("Which Match This Season Changed Your Opinion Most?");
  const midfieldTrioThread = threadByTitle.get("Which Midfield Trio Would You Pay to Watch Every Week?");
  const squadPlayerThread = threadByTitle.get("Best Squad Player in the League?");
  const panicMeterThread = threadByTitle.get("Run-In Panic Meter: Which Top Team Blinks First?");
  const rewatchMatchThread = threadByTitle.get("One Match From This Month You'd Rewatch Tonight");
  const awayEndThread = threadByTitle.get("Best Away End in the League Right Now?");
  const improvedPlayerThread = threadByTitle.get("Most Improved Player Since January");
  const identityThread = threadByTitle.get("Which Club Has the Clearest Identity Right Now?");
  const finalDayHeroThread = threadByTitle.get("Pick Your Last-Day Hero Before the Chaos Starts");
  const arsenalSupportersThread = threadByTitle.get("Arsenal Supporters Corner");
  const liverpoolSupportersThread = threadByTitle.get("Liverpool Supporters Corner");
  const chelseaSupportersThread = threadByTitle.get("Chelsea Supporters Corner");
  const spursSupportersThread = threadByTitle.get("Spurs Supporters Corner");
  const citySupportersThread = threadByTitle.get("Man City Supporters Corner");
  const newcastleSupportersThread = threadByTitle.get("Newcastle Supporters Corner");

  const allDiscussionThreads = [
    thread1,
    thread2,
    thread3,
    thread4,
    thread5,
    thread6,
    thread7,
    thread8,
    thread9,
    thread10,
    thread11,
    thread12,
    ...extraGeneralThreads,
    ...extraTeamThreads,
    ...generatedGeneralThreads,
    ...generatedTeamThreads,
  ];

  allDiscussionThreads.forEach((thread) => {
    seededThreadCreatedAt.set(thread.id, thread.createdAt);
  });

  console.log(
    `Ensured ${
      12 +
      extraGeneralThreads.length +
      extraTeamThreads.length +
      generatedGeneralThreads.length +
      generatedTeamThreads.length
    } general/team threads`
  );

  const restrictedEmails = new Set([
    "supporter07@sportsdeck.com",
    "supporter18@sportsdeck.com",
    "supporter41@sportsdeck.com",
    "supporter63@sportsdeck.com",
    "supporter79@sportsdeck.com",
  ]);
  const activeSeedUsers = users.filter((user) => !restrictedEmails.has(user.email));

  // ─── Posts ───────────────────────────────────────────────────────────────
  const p1 = await ensurePost({
    content: "What a start to the season! Arsenal and City are already trading blows at the top.",
    threadId: thread1.id,
    authorId: users[0].id,
  });

  const p2 = await ensurePost({
    content: "Liverpool look genuinely title-worthy this year. Slot has them playing incredible football.",
    threadId: thread1.id,
    authorId: users[1].id,
  });

  const p3 = await ensurePost({
    content: "Don't sleep on Chelsea. The squad depth is finally paying off.",
    threadId: thread1.id,
    authorId: users[4].id,
  });

  const p4 = await ensurePost({
    content: "City without a natural striker is the biggest tactical puzzle of the season.",
    threadId: thread1.id,
    authorId: users[2].id,
  });

  const p5 = await ensurePost({
    content: "Newcastle are quietly putting together a really solid campaign. Howe deserves more credit.",
    threadId: thread1.id,
    authorId: users[5].id,
  });

  const p6 = await ensurePost({
    content: "Hearing Arsenal are close to signing a striker. Could be the missing piece.",
    threadId: thread2.id,
    authorId: users[3].id,
  });

  const p7 = await ensurePost({
    content: "Chelsea reportedly looking at two more midfielders. Because they don't already have 40.",
    threadId: thread2.id,
    authorId: users[6].id,
  });

  const p8 = await ensurePost({
    content: "Any credible Spurs rumours? We desperately need a centre-back.",
    threadId: thread2.id,
    authorId: users[7].id,
  });

  const p9 = await ensurePost({
    content: "Arsenal. Finally our year. I can feel it.",
    threadId: thread3.id,
    authorId: users[3].id,
  });

  const p10 = await ensurePost({
    content: "City always find a way. Never bet against Guardiola.",
    threadId: thread3.id,
    authorId: users[7].id,
  });

  const p11 = await ensurePost({
    content: "Liverpool are the most complete team right now. My money is on them.",
    threadId: thread3.id,
    authorId: users[1].id,
  });

  const p12 = await ensurePost({
    content: "Southampton look done for. No wins in ages.",
    threadId: thread4.id,
    authorId: users[0].id,
  });

  const p13 = await ensurePost({
    content: "Ipswich are fighting hard but the gap at the bottom is worrying.",
    threadId: thread4.id,
    authorId: users[2].id,
  });

  const p14 = await ensurePost({
    content: "Salah has to be in. Best player in the league by a mile this season.",
    threadId: thread5.id,
    authorId: users[1].id,
  });

  const p15 = await ensurePost({
    content: "Palmer's creativity has been unreal. Easily in my XI.",
    threadId: thread5.id,
    authorId: users[4].id,
  });

  const p16 = await ensurePost({
    content: "Can't leave out Saka. Consistent all season long.",
    threadId: thread5.id,
    authorId: users[3].id,
  });

  const p17 = await ensurePost({
    content: "Wolves feel like one bad month away from panic mode. The performances are flatter than the results suggest.",
    threadId: thread6.id,
    authorId: users[0].id,
  });

  const p18 = await ensurePost({
    content: "I still think patience matters. Some clubs sack managers at the first sign of turbulence and end up worse off.",
    threadId: thread6.id,
    authorId: users[5].id,
  });

  const p19 = await ensurePost({
    content: "Chelsea and Newcastle both have the talent, but I trust Newcastle's structure more.",
    threadId: thread7.id,
    authorId: users[4].id,
  });

  const p20 = await ensurePost({
    content: "Spurs will be in it until the final week if they keep their key attackers healthy.",
    threadId: thread7.id,
    authorId: users[7].id,
  });

  const p21 = await ensurePost({
    content: "Arsenal vs Liverpool is the obvious headliner, but I'm weirdly excited for the Sunday late kickoff too.",
    threadId: thread8.id,
    authorId: users[3].id,
  });

  const p22 = await ensurePost({
    content: "Any weekend with a relegation six-pointer is automatically must-watch for me.",
    threadId: thread8.id,
    authorId: users[2].id,
  });

  const p23 = await ensurePost({
    content: "Palmer is already influencing matches like a veteran. Hard to look past him.",
    threadId: thread9.id,
    authorId: users[1].id,
  });

  const p24 = await ensurePost({
    content: "Mainoo's composure stands out every time I watch him. He never looks rushed.",
    threadId: thread9.id,
    authorId: users[6].id,
  });

  const p25 = await ensurePost({
    content: "A good low block can be beautiful if the spacing is right. The problem is when teams stop offering any counter threat.",
    threadId: thread10.id,
    authorId: users[5].id,
  });

  const p26 = await ensurePost({
    content: "I'm fine with pragmatism. I'm not fine with pretending six defenders on the edge of the box is some tactical masterpiece.",
    threadId: thread10.id,
    authorId: users[4].id,
  });

  const p27 = await ensurePost({
    content: "For Arsenal it's still striker, left-sided rotation, and maybe another midfielder if the market opens up.",
    threadId: thread11.id,
    authorId: users[3].id,
  });

  const p28 = await ensurePost({
    content: "United need a right-back, another central midfielder, and a clear plan more than anything else.",
    threadId: thread11.id,
    authorId: users[2].id,
  });

  const p29 = await ensurePost({
    content: "Matz Sels doesn't get enough love for how much stability he's given Forest this year.",
    threadId: thread12.id,
    authorId: users[0].id,
  });

  const p30 = await ensurePost({
    content: "I know it's not trendy, but smart full-backs change entire build-up patterns and usually get overlooked.",
    threadId: thread12.id,
    authorId: users[5].id,
  });

  const p31 = await ensurePost({
    content: "Ryan Gravenberch quietly solving Liverpool's midfield balance has been one of the stories of the season for me.",
    threadId: thread12.id,
    authorId: users[1].id,
  });

  const p32 = bestAtmosphereThread ? await ensurePost({
    content: "Selhurst Park under the lights still feels different to me. You can sense the game speeding up when the crowd gets going.",
    threadId: bestAtmosphereThread.id,
    authorId: users[0].id,
  }) : null;
  const p33 = bestAtmosphereThread ? await ensurePost({
    content: "Anfield on a proper European-style league night is still the benchmark even if every fanbase will argue otherwise.",
    threadId: bestAtmosphereThread.id,
    authorId: users[1].id,
  }) : null;
  const p34 = fixtureCongestionThread ? await ensurePost({
    content: "If you are still playing the same front six every three days by February, you are begging for soft tissue injuries.",
    threadId: fixtureCongestionThread.id,
    authorId: users[2].id,
  }) : null;
  const p35 = fixtureCongestionThread ? await ensurePost({
    content: "Rotation is easy to say and harder to do when your second unit changes the entire build-up tempo.",
    threadId: fixtureCongestionThread.id,
    authorId: users[5].id,
  }) : null;
  const p36 = midTableThread ? await ensurePost({
    content: "Bournemouth are the kind of smart club that could jump quickly with two or three nailed signings.",
    threadId: midTableThread.id,
    authorId: users[4].id,
  }) : null;
  const p37 = midTableThread ? await ensurePost({
    content: "Brighton always feel one reset away from pushing again because the structure underneath is so strong.",
    threadId: midTableThread.id,
    authorId: users[6].id,
  }) : null;
  const p38 = setPieceThread ? await ensurePost({
    content: "Arsenal's corner routines look absurdly rehearsed. The blockers, the timing, the second-ball positions, all of it.",
    threadId: setPieceThread.id,
    authorId: users[3].id,
  }) : null;
  const p39 = deadlineDayThread ? await ensurePost({
    content: "I just want one deadline day where my club quietly signs exactly the right profile instead of six linked names and zero arrivals.",
    threadId: deadlineDayThread.id,
    authorId: users[7].id,
  }) : null;
  const p40 = changedOpinionThread ? await ensurePost({
    content: "Villa away to a top side changed my read on them. They looked like they belonged at that level from minute one.",
    threadId: changedOpinionThread.id,
    authorId: users[4].id,
  }) : null;
  const p41 = arsenalSupportersThread ? await ensurePost({
    content: "I still think Arsenal need one killer in the box. The control is there, but the game-state comfort is not.",
    threadId: arsenalSupportersThread.id,
    authorId: users[3].id,
  }) : null;
  const p42 = arsenalSupportersThread ? await ensurePost({
    content: "The left eight spot is still the biggest debate for me. Too many good options, none fully locked in.",
    threadId: arsenalSupportersThread.id,
    authorId: users[0].id,
  }) : null;
  const p43 = liverpoolSupportersThread ? await ensurePost({
    content: "Liverpool's midfield balance is miles better now, but I still want another defender if the market opens up.",
    threadId: liverpoolSupportersThread.id,
    authorId: users[1].id,
  }) : null;
  const p44 = chelseaSupportersThread ? await ensurePost({
    content: "Chelsea's best performances happen when the spacing is simple. The more experimental it gets, the shakier they look.",
    threadId: chelseaSupportersThread.id,
    authorId: users[5].id,
  }) : null;
  const p45 = spursSupportersThread ? await ensurePost({
    content: "Spurs need one calm defender so badly. Every match turns into chaos the second the line gets stretched.",
    threadId: spursSupportersThread.id,
    authorId: users[6].id,
  }) : null;
  const p46 = citySupportersThread ? await ensurePost({
    content: "City's standards are ridiculous because a draw somehow feels like a full-blown tactical crisis by Monday morning.",
    threadId: citySupportersThread.id,
    authorId: users[7].id,
  }) : null;
  const p47 = newcastleSupportersThread ? await ensurePost({
    content: "Newcastle have built a proper identity. Even when they rotate, you can still tell what they are trying to do.",
    threadId: newcastleSupportersThread.id,
    authorId: users[4].id,
  }) : null;
  const p48 = arsenalSupportersThread ? await ensurePost({
    content: "For Arsenal I would take striker, winger depth, and another midfielder with legs. Then I would stop pretending that is enough.",
    threadId: arsenalSupportersThread.id,
    authorId: users[1].id,
  }) : null;
  const p49 = liverpoolSupportersThread ? await ensurePost({
    content: "Liverpool's press is scarier when the front line trusts the midfield behind them. You can see the confidence now.",
    threadId: liverpoolSupportersThread.id,
    authorId: users[2].id,
  }) : null;
  const p50 = chelseaSupportersThread ? await ensurePost({
    content: "Chelsea need to trim the squad before they add more. Half the drama is just role confusion every month.",
    threadId: chelseaSupportersThread.id,
    authorId: users[4].id,
  }) : null;
  const p51 = spursSupportersThread ? await ensurePost({
    content: "Spurs supporters are one clean-sheet run away from talking themselves into anything again, and honestly I respect that.",
    threadId: spursSupportersThread.id,
    authorId: users[0].id,
  }) : null;
  const p52 = citySupportersThread ? await ensurePost({
    content: "City can still rotate six players and keep their spacing. That is the real thing everyone else is chasing.",
    threadId: citySupportersThread.id,
    authorId: users[2].id,
  }) : null;
  const p53 = newcastleSupportersThread ? await ensurePost({
    content: "Newcastle need slightly more creativity in the final third, but the platform is there for a big season.",
    threadId: newcastleSupportersThread.id,
    authorId: users[5].id,
  }) : null;
  const p54 = bestAtmosphereThread ? await ensurePost({
    content: "The best atmosphere shout always depends on the scoreline. Every ground sounds amazing when belief shows up early.",
    threadId: bestAtmosphereThread.id,
    authorId: users[7].id,
  }) : null;
  const p55 = fixtureCongestionThread ? await ensurePost({
    content: "Fixture congestion punishes the teams with no midfield legs first. Once the distances go, everything else follows.",
    threadId: fixtureCongestionThread.id,
    authorId: users[1].id,
  }) : null;
  const p56 = changedOpinionThread ? await ensurePost({
    content: "The match that flipped my opinion most was Liverpool away to a direct side and just controlling every second ball anyway.",
    threadId: changedOpinionThread.id,
    authorId: users[6].id,
  }) : null;
  const p57 = midfieldTrioThread ? await ensurePost({
    content: "Rodri, Bernardo, and De Bruyne when they are all in rhythm still feels like football played on fast-forward.",
    threadId: midfieldTrioThread.id,
    authorId: users[7].id,
  }) : null;
  const p58 = midfieldTrioThread ? await ensurePost({
    content: "I would pay to watch a midfield that never stops moving off the ball. Arsenal's best combinations get close to that feeling.",
    threadId: midfieldTrioThread.id,
    authorId: users[3].id,
  }) : null;
  const p59 = squadPlayerThread ? await ensurePost({
    content: "The best squad players are the ones who never make the structure worse. They just slide in and the team still looks like itself.",
    threadId: squadPlayerThread.id,
    authorId: users[2].id,
  }) : null;
  const p60 = squadPlayerThread ? await ensurePost({
    content: "Give me a full-back who can play both sides and never panics in possession. That player saves entire seasons.",
    threadId: squadPlayerThread.id,
    authorId: users[5].id,
  }) : null;
  const p61 = panicMeterThread ? await ensurePost({
    content: "Liverpool look the calmest to me. The shape survives bad moments better than most challengers.",
    threadId: panicMeterThread.id,
    authorId: users[8].id,
  }) : null;
  const p62 = panicMeterThread ? await ensurePost({
    content: "The panic answer is whichever side suddenly starts protecting one-goal leads in the 60th minute instead of playing their game.",
    threadId: panicMeterThread.id,
    authorId: users[9].id,
  }) : null;
  const p63 = rewatchMatchThread ? await ensurePost({
    content: "I would absolutely rewatch the Arsenal-Liverpool chaos from earlier this month. It had tactical adjustments and complete emotional nonsense at the same time.",
    threadId: rewatchMatchThread.id,
    authorId: users[10].id,
  }) : null;
  const p64 = rewatchMatchThread ? await ensurePost({
    content: "Give me a late comeback with both benches losing their minds over a tidy 3-0 any day.",
    threadId: rewatchMatchThread.id,
    authorId: users[3].id,
  }) : null;
  const p65 = awayEndThread ? await ensurePost({
    content: "Newcastle's away end always sounds like it arrived two hours before kickoff and never sat down once.",
    threadId: awayEndThread.id,
    authorId: users[11].id,
  }) : null;
  const p66 = awayEndThread ? await ensurePost({
    content: "Palace and Leeds always get the reputation, but some of the mid-table away followings have been louder all season.",
    threadId: awayEndThread.id,
    authorId: users[10].id,
  }) : null;
  const p67 = improvedPlayerThread ? await ensurePost({
    content: "Since January, Gravenberch looks like he finally understands exactly where the game will be one pass early.",
    threadId: improvedPlayerThread.id,
    authorId: users[12].id,
  }) : null;
  const p68 = improvedPlayerThread ? await ensurePost({
    content: "I am going with a full-back shout because confidence changes that role more than almost any other on the pitch.",
    threadId: improvedPlayerThread.id,
    authorId: users[5].id,
  }) : null;
  const p69 = identityThread ? await ensurePost({
    content: "Bournemouth are one of the clearest identity teams in the league right now. You can tell what they want within two pressing triggers.",
    threadId: identityThread.id,
    authorId: users[13].id,
  }) : null;
  const p70 = identityThread ? await ensurePost({
    content: "Arsenal and City are obvious answers, but I respect any club you can recognise from their rest defence alone.",
    threadId: identityThread.id,
    authorId: users[2].id,
  }) : null;
  const p71 = finalDayHeroThread ? await ensurePost({
    content: "Give me a centre-back scoring off a horrible near-post flick in stoppage time. Final day drama should always look slightly accidental.",
    threadId: finalDayHeroThread.id,
    authorId: users[13].id,
  }) : null;
  const p72 = finalDayHeroThread ? await ensurePost({
    content: "My emergency hero pick is always the squad winger who has done nothing for two months and suddenly turns into a legend for six minutes.",
    threadId: finalDayHeroThread.id,
    authorId: users[8].id,
  }) : null;
  const p73 = panicMeterThread ? await ensurePost({
    content: "Title races get decided by who still trusts their rotation on a Wednesday night. That is where the blink usually starts.",
    threadId: panicMeterThread.id,
    authorId: users[12].id,
  }) : null;
  const p74 = identityThread ? await ensurePost({
    content: "The best identity teams make even their ugly wins look familiar. That matters more to me than one flashy match.",
    threadId: identityThread.id,
    authorId: users[9].id,
  }) : null;

  const posts = [
    p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16,
    p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31,
    p32, p33, p34, p35, p36, p37, p38, p39, p40, p41, p42, p43, p44, p45, p46,
    p47, p48, p49, p50, p51, p52, p53, p54, p55, p56, p57, p58, p59, p60, p61,
    p62, p63, p64, p65, p66, p67, p68, p69, p70, p71, p72, p73, p74,
  ].filter(Boolean);

  console.log(`Ensured ${posts.length} posts`);

  // ─── Replies ─────────────────────────────────────────────────────────────
  const r1 = await ensurePost({
      content: "Agreed! Slot has been exceptional. Top 3 manager in the league right now.",
      threadId: thread1.id,
      authorId: users[2].id,
      parentId: p2.id,
    });
  const r2 = await ensurePost({
      content: "City always bounce back though. Don't write them off.",
      threadId: thread1.id,
      authorId: users[7].id,
      parentId: p4.id,
    });
  const r3 = await ensurePost({
      content: "Would be huge. A goal scorer is all they've been missing.",
      threadId: thread2.id,
      authorId: users[0].id,
      parentId: p6.id,
    });
  const r4 = await ensurePost({
      content: "Haha fair point. Their squad management is a mess.",
      threadId: thread2.id,
      authorId: users[1].id,
      parentId: p7.id,
    });
  const r5 = await ensurePost({
      content: "Salah + Palmer + Saka front three would be unstoppable.",
      threadId: thread5.id,
      authorId: users[6].id,
      parentId: p14.id,
    });
  const r6 = await ensurePost({
      content: "Exactly. Results can flatter a setup for a while, but the underlying control isn't there.",
      threadId: thread6.id,
      authorId: users[4].id,
      parentId: p17.id,
    });
  const r7 = await ensurePost({
      content: "Same. Newcastle feel like the side with the clearest identity in that chase.",
      threadId: thread7.id,
      authorId: users[1].id,
      parentId: p19.id,
    });
  const r8 = await ensurePost({
      content: "Relegation drama always delivers. The tension is different when every point changes the table.",
      threadId: thread8.id,
      authorId: users[7].id,
      parentId: p22.id,
    });
  const r9 = await ensurePost({
      content: "Palmer's decision-making has jumped a level. It's not just output anymore, it's control.",
      threadId: thread9.id,
      authorId: users[4].id,
      parentId: p23.id,
    });
  const r10 = await ensurePost({
      content: "The counter threat point is key. If you never stretch the game, all you're doing is inviting pressure.",
      threadId: thread10.id,
      authorId: users[6].id,
      parentId: p25.id,
    });
  const r11 = await ensurePost({
      content: "Every club wish list starts with three signings and somehow ends with seven once the debate starts.",
      threadId: thread11.id,
      authorId: users[5].id,
      parentId: p27.id,
    });
  const r12 = await ensurePost({
      content: "Agree on full-backs. People notice wingers and strikers first, but the balance often comes from deeper roles.",
      threadId: thread12.id,
      authorId: users[2].id,
      parentId: p30.id,
    });
  const r13 = p32 ? await ensurePost({
    content: "Palace under the lights is the one that feels most relentless to me.",
    threadId: p32.threadId,
    authorId: users[3].id,
    parentId: p32.id,
  }) : null;
  const r14 = r13 ? await ensurePost({
    content: "Exactly. It is the combination of noise and the game state spiraling quickly.",
    threadId: r13.threadId,
    authorId: users[5].id,
    parentId: r13.id,
  }) : null;
  const r15 = r14 ? await ensurePost({
    content: "And when the away end bites back it somehow makes the whole thing louder.",
    threadId: r14.threadId,
    authorId: users[0].id,
    parentId: r14.id,
  }) : null;
  const r16 = p34 ? await ensurePost({
    content: "Rotation only works if the principles stay visible. Too many managers rotate names and lose all rhythm.",
    threadId: p34.threadId,
    authorId: users[6].id,
    parentId: p34.id,
  }) : null;
  const r17 = r16 ? await ensurePost({
    content: "That is why the best-coached sides can swap two or three pieces without the distances collapsing.",
    threadId: r16.threadId,
    authorId: users[1].id,
    parentId: r16.id,
  }) : null;
  const r18 = p36 ? await ensurePost({
    content: "Bournemouth are my pick too. They look like a club that actually knows what profile to buy next.",
    threadId: p36.threadId,
    authorId: users[7].id,
    parentId: p36.id,
  }) : null;
  const r19 = p37 ? await ensurePost({
    content: "Brighton always get the benefit of the doubt because the recruitment floor is so high.",
    threadId: p37.threadId,
    authorId: users[2].id,
    parentId: p37.id,
  }) : null;
  const r20 = p38 ? await ensurePost({
    content: "Arsenal's blocking patterns feel like set-piece theatre at this point.",
    threadId: p38.threadId,
    authorId: users[0].id,
    parentId: p38.id,
  }) : null;
  const r21 = r20 ? await ensurePost({
    content: "And the second-ball structure is what separates them from teams who just whip deliveries in hopefully.",
    threadId: r20.threadId,
    authorId: users[4].id,
    parentId: r20.id,
  }) : null;
  const r22 = p39 ? await ensurePost({
    content: "The realistic version of deadline day is one signing and three leaked medicals that never happen.",
    threadId: p39.threadId,
    authorId: users[5].id,
    parentId: p39.id,
  }) : null;
  const r23 = p40 ? await ensurePost({
    content: "That Villa performance felt like the moment everyone stopped describing them as just a fun story.",
    threadId: p40.threadId,
    authorId: users[3].id,
    parentId: p40.id,
  }) : null;
  const r24 = p41 ? await ensurePost({
    content: "Still think the striker conversation is the key one. Too many matches still depend on perfect chance creation.",
    threadId: p41.threadId,
    authorId: users[6].id,
    parentId: p41.id,
  }) : null;
  const r25 = r24 ? await ensurePost({
    content: "That is where I am too. Control is great until you need a ruthless five-minute stretch to kill the match.",
    threadId: r24.threadId,
    authorId: users[3].id,
    parentId: r24.id,
  }) : null;
  const r26 = p42 ? await ensurePost({
    content: "The left eight debate is secretly about what type of striker you expect to play with.",
    threadId: p42.threadId,
    authorId: users[1].id,
    parentId: p42.id,
  }) : null;
  const r27 = p43 ? await ensurePost({
    content: "Liverpool's structure without the ball feels so much calmer now. The distances are finally trustworthy.",
    threadId: p43.threadId,
    authorId: users[4].id,
    parentId: p43.id,
  }) : null;
  const r28 = p49 ? await ensurePost({
    content: "Exactly. The press looks aggressive again because the recovery positions behind it are cleaner.",
    threadId: p49.threadId,
    authorId: users[1].id,
    parentId: p49.id,
  }) : null;
  const r29 = p44 ? await ensurePost({
    content: "Chelsea's biggest enemy is still overcomplication. Simpler roles make the talent show up faster.",
    threadId: p44.threadId,
    authorId: users[2].id,
    parentId: p44.id,
  }) : null;
  const r30 = p50 ? await ensurePost({
    content: "Role confusion is exactly it. You can survive a young squad, but not a young squad learning a new map every week.",
    threadId: p50.threadId,
    authorId: users[5].id,
    parentId: p50.id,
  }) : null;
  const r31 = p45 ? await ensurePost({
    content: "Spurs with one calmer defender and two healthy full-backs would feel like a completely different conversation.",
    threadId: p45.threadId,
    authorId: users[7].id,
    parentId: p45.id,
  }) : null;
  const r32 = p51 ? await ensurePost({
    content: "The chaos is part of the brand now, but maybe it does not need to be every single week.",
    threadId: p51.threadId,
    authorId: users[6].id,
    parentId: p51.id,
  }) : null;
  const r33 = p46 ? await ensurePost({
    content: "City turning draws into crises says more about their standards than their problems.",
    threadId: p46.threadId,
    authorId: users[1].id,
    parentId: p46.id,
  }) : null;
  const r34 = p52 ? await ensurePost({
    content: "That is what kills everybody else. Their baseline control barely changes even when the personnel does.",
    threadId: p52.threadId,
    authorId: users[2].id,
    parentId: p52.id,
  }) : null;
  const r35 = p47 ? await ensurePost({
    content: "Newcastle's floor is what impresses me now. Even the less glamorous wins still look like themselves.",
    threadId: p47.threadId,
    authorId: users[0].id,
    parentId: p47.id,
  }) : null;
  const r36 = p53 ? await ensurePost({
    content: "A little more creativity and one more dependable rotation forward would change the ceiling fast.",
    threadId: p53.threadId,
    authorId: users[4].id,
    parentId: p53.id,
  }) : null;
  const r37 = p54 ? await ensurePost({
    content: "Crowd noise is weirdly fragile too. One early VAR check can kill a place for ten minutes.",
    threadId: p54.threadId,
    authorId: users[6].id,
    parentId: p54.id,
  }) : null;
  const r38 = r37 ? await ensurePost({
    content: "That is so true. Atmosphere chats always forget how much momentum shapes the sound.",
    threadId: r37.threadId,
    authorId: users[7].id,
    parentId: r37.id,
  }) : null;
  const r39 = p55 ? await ensurePost({
    content: "Midfield legs really are the first thing to go. Once transitions stop being clean, the whole side looks exhausted.",
    threadId: p55.threadId,
    authorId: users[3].id,
    parentId: p55.id,
  }) : null;
  const r40 = p56 ? await ensurePost({
    content: "That match flipped me too. They handled the ugly parts of the game better than I expected.",
    threadId: p56.threadId,
    authorId: users[1].id,
    parentId: p56.id,
  }) : null;
  const r41 = p57 ? await ensurePost({
    content: "City's midfield always wins this conversation if you let chemistry count as much as talent.",
    threadId: p57.threadId,
    authorId: users[1].id,
    parentId: p57.id,
  }) : null;
  const r42 = p58 ? await ensurePost({
    content: "That is why the watchability answer changes depending on whether you value control or chaos.",
    threadId: p58.threadId,
    authorId: users[4].id,
    parentId: p58.id,
  }) : null;
  const r43 = p59 ? await ensurePost({
    content: "Exactly. A true squad player keeps the shape recognisable, which is way rarer than people admit.",
    threadId: p59.threadId,
    authorId: users[0].id,
    parentId: p59.id,
  }) : null;
  const r44 = p60 ? await ensurePost({
    content: "Versatile full-backs are like cheat codes once fixtures pile up. Every manager wants one and half the league has none.",
    threadId: p60.threadId,
    authorId: users[6].id,
    parentId: p60.id,
  }) : null;
  const r45 = p61 ? await ensurePost({
    content: "That calmness is why I trust them too. They do not start chasing the match structure the second something goes wrong.",
    threadId: p61.threadId,
    authorId: users[1].id,
    parentId: p61.id,
  }) : null;
  const r46 = p63 ? await ensurePost({
    content: "That match had the perfect amount of tactical chess before both teams gave up and embraced chaos.",
    threadId: p63.threadId,
    authorId: users[9].id,
    parentId: p63.id,
  }) : null;
  const r47 = p65 ? await ensurePost({
    content: "Newcastle away support travels like the match is an event, not just another fixture. You can hear it in every close game.",
    threadId: p65.threadId,
    authorId: users[4].id,
    parentId: p65.id,
  }) : null;
  const r48 = p67 ? await ensurePost({
    content: "That is a good shout. He looks half a second quicker mentally, which changes everything in midfield.",
    threadId: p67.threadId,
    authorId: users[11].id,
    parentId: p67.id,
  }) : null;
  const r49 = p69 ? await ensurePost({
    content: "Bournemouth are such a good answer because even their risk-taking looks coached instead of random.",
    threadId: p69.threadId,
    authorId: users[12].id,
    parentId: p69.id,
  }) : null;
  const r50 = p71 ? await ensurePost({
    content: "Final-day goals should always come from the least elegant possible source. Scruffy heroes are mandatory.",
    threadId: p71.threadId,
    authorId: users[10].id,
    parentId: p71.id,
  }) : null;
  const r51 = p72 ? await ensurePost({
    content: "That is the correct pick. There is always one bench winger who becomes folklore for exactly seven touches.",
    threadId: p72.threadId,
    authorId: users[3].id,
    parentId: p72.id,
  }) : null;
  const r52 = p74 ? await ensurePost({
    content: "Exactly. If a team only looks like itself in ideal conditions, I do not really believe in the identity yet.",
    threadId: p74.threadId,
    authorId: users[13].id,
    parentId: p74.id,
  }) : null;

  const replies = [
    r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17,
    r18, r19, r20, r21, r22, r23, r24, r25, r26, r27, r28, r29, r30, r31, r32,
    r33, r34, r35, r36, r37, r38, r39, r40, r41, r42, r43, r44, r45, r46, r47,
    r48, r49, r50, r51, r52,
  ].filter(Boolean);

  console.log(`Ensured ${replies.length} replies`);

  const multilingualComments = [
    "Creo que este hilo se entiende mejor si miramos cómo cambió el partido después del descanso.",
    "Franchement, ce débat devient bien plus intéressant quand on compare les ajustements sans ballon.",
    "Ich finde, man erkennt die wahre Qualität einer Mannschaft erst daran, wie ruhig sie nach dem Gegentor bleibt.",
    "Para mim, a diferença está na tomada de decisão nos últimos quinze minutos.",
    "Secondo me questa squadra cresce tantissimo quando il ritmo della partita si spezza.",
    "Volgens mij zie je pas echt structuur wanneer een ploeg onder druk toch hetzelfde idee blijft volgen.",
    "برأيي النقطة الأهم هنا هي كيف تغيّر إيقاع المباراة بعد أول تبديل.",
    "この流れを見ると、後半の立ち位置の修正が勝負を分けたと思います。",
    "제 생각에는 이 장면보다도 그 이후의 압박 강도가 더 중요했어요.",
    "मेरे हिसाब से असली फर्क यह था कि टीम ने दबाव में भी अपनी बनावट नहीं छोड़ी।",
  ];
  const topLevelTemplates = [
    "The bit I keep circling back to in %thread% is how the control changes once the tempo rises.",
    "This thread mostly confirms my feeling that %thread% comes down to who handles second balls better.",
    "My honest takeaway from %thread% is that the shape matters more than the star names.",
    "I like the talent involved here, but %thread% still feels like a spacing conversation first.",
    "If %thread% tells us anything, it is that small adjustments have decided more than headline moments.",
    "Watching %thread% again, I keep noticing how much cleaner the good teams are between the boxes.",
  ];
  const replyTemplates = [
    "That is fair, but I think the bigger swing came from the out-of-possession structure, not the finishing.",
    "I get that angle. The one thing I would add is that the rhythm changed the second the midfield distances opened up.",
    "Completely with you on the broad point, although I still think game state explains half of it.",
    "That reads right to me. The press looked coordinated early and much looser once the match stretched.",
    "Same here. The details around the full-backs and rest defence make the whole thing easier to understand.",
    "I had the same reaction, especially once the benches started changing the matchup on that side.",
  ];
  const nestedReplyTemplates = [
    "Exactly, and that is why I would separate the tactical idea from the emotional momentum.",
    "That is the key distinction for me too. The intent stayed the same even when execution got messy.",
    "Yes, and it is probably why the thread feels more balanced than the final scoreline suggests.",
    "Agreed. Once you watch the sequence back, the adjustment looks deliberate rather than accidental.",
    "That is where I landed as well. The pattern was there long before the highlight everyone remembers.",
  ];

  let generatedTopLevelComments = 0;
  let generatedReplyComments = 0;
  let generatedNestedComments = 0;
  let generatedEditedComments = 0;
  let multilingualCursor = 0;

  for (const [threadIndex, thread] of allDiscussionThreads.entries()) {
    const totalGeneratedComments = thread.id % 11;
    if (totalGeneratedComments === 0) continue;

    const label = compactThreadLabel(thread.title);
    const topLevelCount = Math.min(3, Math.max(1, Math.floor((totalGeneratedComments + 2) / 4)));
    const topLevelPostsForThread = [];

    for (let slot = 0; slot < topLevelCount; slot += 1) {
      const author = activeSeedUsers[(thread.id + slot * 7 + threadIndex) % activeSeedUsers.length];
      const createdAt = nextPostTimestamp(thread.id);
      const multilingualContent =
        multilingualCursor < multilingualComments.length && slot === 0
          ? multilingualComments[multilingualCursor]
          : null;
      const finalContent =
        multilingualContent ??
        topLevelTemplates[(thread.id + slot) % topLevelTemplates.length].replaceAll("%thread%", label);

      const shouldEditTopLevel =
        !multilingualContent && (thread.id + slot) % 6 === 0;
      const post = shouldEditTopLevel
        ? await ensureEditedPost({
            originalContent: `${finalContent} I am still not fully sure about the last phase, though.`,
            content: `${finalContent} The more I watch it, the clearer that final phase becomes.`,
            threadId: thread.id,
            authorId: author.id,
            createdAt,
            editHistory: [
              {
                content: `${finalContent} I am still not fully sure about the last phase, though.`,
                editedAt: addMinutes(createdAt, 26 + ((thread.id + slot) % 11)),
              },
            ],
          })
        : await ensurePost({
            content: finalContent,
            threadId: thread.id,
            authorId: author.id,
            createdAt,
          });

      if (multilingualContent) {
        multilingualCursor += 1;
      }
      if (shouldEditTopLevel) {
        generatedEditedComments += 1;
      }

      generatedTopLevelComments += 1;
      topLevelPostsForThread.push(post);
    }

    let remainingReplies = totalGeneratedComments - topLevelCount;
    const replyRoots = [];

    if (remainingReplies > 0 && topLevelPostsForThread.length > 0) {
      const firstParent = topLevelPostsForThread[0];
      const firstReplyAuthor =
        activeSeedUsers[(thread.id + 19 + threadIndex) % activeSeedUsers.length];
      const firstReplyCreatedAt = nextPostTimestamp(thread.id);
      const firstReply = await ensurePost({
        content: replyTemplates[(thread.id + threadIndex) % replyTemplates.length],
        threadId: thread.id,
        authorId: firstReplyAuthor.id,
        parentId: firstParent.id,
        createdAt: firstReplyCreatedAt,
      });
      generatedReplyComments += 1;
      remainingReplies -= 1;
      replyRoots.push(firstReply);
    }

    if (remainingReplies > 0 && replyRoots.length > 0) {
      const nestedParent = replyRoots[0];
      const nestedAuthor =
        activeSeedUsers[(thread.id + 31 + threadIndex) % activeSeedUsers.length];
      const nestedCreatedAt = nextPostTimestamp(thread.id);
      const shouldEditNested = thread.id % 9 === 0;
      await (shouldEditNested
        ? ensureEditedPost({
            originalContent: `${nestedReplyTemplates[(thread.id + 1) % nestedReplyTemplates.length]} I posted too quickly the first time.`,
            content: `${nestedReplyTemplates[(thread.id + 1) % nestedReplyTemplates.length]} I went back and rewrote this once the sequence made more sense.`,
            threadId: thread.id,
            authorId: nestedAuthor.id,
            parentId: nestedParent.id,
            createdAt: nestedCreatedAt,
            editHistory: [
              {
                content: `${nestedReplyTemplates[(thread.id + 1) % nestedReplyTemplates.length]} I posted too quickly the first time.`,
                editedAt: addMinutes(nestedCreatedAt, 14 + (thread.id % 9)),
              },
            ],
          })
        : ensurePost({
            content: nestedReplyTemplates[(thread.id + 1) % nestedReplyTemplates.length],
            threadId: thread.id,
            authorId: nestedAuthor.id,
            parentId: nestedParent.id,
            createdAt: nestedCreatedAt,
          }));
      if (shouldEditNested) {
        generatedEditedComments += 1;
      }
      generatedNestedComments += 1;
      remainingReplies -= 1;
    }

    let replyCursor = 0;
    while (remainingReplies > 0 && topLevelPostsForThread.length > 0) {
      const parent = topLevelPostsForThread[replyCursor % topLevelPostsForThread.length];
      const author =
        activeSeedUsers[(thread.id + 43 + replyCursor + threadIndex) % activeSeedUsers.length];
      const createdAt = nextPostTimestamp(thread.id);
      const shouldEditReply =
        remainingReplies % 3 === 0 && (thread.id + replyCursor) % 8 === 0;

      await (shouldEditReply
        ? ensureEditedPost({
            originalContent: `${replyTemplates[(thread.id + replyCursor + 2) % replyTemplates.length]} I probably overstated it at first.`,
            content: `${replyTemplates[(thread.id + replyCursor + 2) % replyTemplates.length]} Looking back, the first half matters a bit less than I initially thought.`,
            threadId: thread.id,
            authorId: author.id,
            parentId: parent.id,
            createdAt,
            editHistory: [
              {
                content: `${replyTemplates[(thread.id + replyCursor + 2) % replyTemplates.length]} I probably overstated it at first.`,
                editedAt: addMinutes(createdAt, 12 + ((thread.id + replyCursor) % 10)),
              },
            ],
          })
        : ensurePost({
            content:
              replyTemplates[(thread.id + replyCursor + 2) % replyTemplates.length],
            threadId: thread.id,
            authorId: author.id,
            parentId: parent.id,
            createdAt,
          }));

      if (shouldEditReply) {
        generatedEditedComments += 1;
      }
      generatedReplyComments += 1;
      remainingReplies -= 1;
      replyCursor += 1;
    }
  }

  console.log(
    `Generated ${generatedTopLevelComments} top-level comments, ${generatedReplyComments} replies, and ${generatedNestedComments} nested replies across all threads`
  );
  console.log(
    `Added ${generatedEditedComments} edited comments and ${multilingualCursor} multilingual comments`
  );

  const matchThreads = await prisma.thread.findMany({
    where: {
      type: "MATCH",
      isHidden: false,
      match: {
        isNot: null,
      },
    },
    include: {
      match: {
        include: {
          homeTeam: {
            select: { id: true, name: true, shortName: true },
          },
          awayTeam: {
            select: { id: true, name: true, shortName: true },
          },
        },
      },
    },
    orderBy: [{ openAt: "asc" }, { id: "asc" }],
    take: 2,
  });

  if (matchThreads.length > 0) {
    const positiveTemplates = [
      "What a brilliant performance from %team%. The shape, intensity, and confidence have been outstanding.",
      "%team% have looked sharp all night. This is the kind of display that makes supporters believe again.",
      "So impressed by %team% here. The pressing and composure have both been excellent.",
      "%team% deserved that moment. They have been the better side and the energy has been fantastic.",
      "This is such a strong showing from %team%. Every good phase feels intentional and well-drilled.",
    ];
    const negativeTemplates = [
      "%team% have been really frustrating to watch. Too many sloppy decisions and not enough control.",
      "This has been a rough outing for %team%. They look flat, predictable, and second-best in every duel.",
      "Hard to defend %team% tonight. The structure has been messy and the performance feels poor.",
      "%team% have offered almost nothing going forward. It has been an ugly, disappointing display.",
      "This is one of %team%'s weaker performances lately. Everything feels rushed and out of sync.",
    ];

    let seededMatchSentimentPosts = 0;

    for (const [index, thread] of matchThreads.entries()) {
      if (!thread.match) continue;

      const homeSupporters = activeSeedUsers.filter(
        (user) => user.favoriteTeamId === thread.match?.homeTeam.id
      );
      const awaySupporters = activeSeedUsers.filter(
        (user) => user.favoriteTeamId === thread.match?.awayTeam.id
      );

      if (homeSupporters.length === 0 || awaySupporters.length === 0) {
        continue;
      }

      seededThreadCreatedAt.set(thread.id, thread.createdAt);

      const homePositive = index % 2 === 0;
      const homeTemplates = homePositive ? positiveTemplates : negativeTemplates;
      const awayTemplates = homePositive ? negativeTemplates : positiveTemplates;
      const homeTeamLabel = thread.match.homeTeam.shortName || thread.match.homeTeam.name;
      const awayTeamLabel = thread.match.awayTeam.shortName || thread.match.awayTeam.name;
      const perSideCount = 4;

      for (let slot = 0; slot < perSideCount; slot += 1) {
        const homeAuthor = homeSupporters[slot % homeSupporters.length];
        const awayAuthor = awaySupporters[slot % awaySupporters.length];

        const homePost = await ensurePost({
          content: homeTemplates[(thread.id + slot) % homeTemplates.length].replaceAll(
            "%team%",
            homeTeamLabel
          ),
          threadId: thread.id,
          authorId: homeAuthor.id,
          createdAt: nextPostTimestamp(thread.id),
        });
        seededMatchSentimentPosts += 1;

        const awayPost = await ensurePost({
          content: awayTemplates[(thread.id + slot + 1) % awayTemplates.length].replaceAll(
            "%team%",
            awayTeamLabel
          ),
          threadId: thread.id,
          authorId: awayAuthor.id,
          createdAt: nextPostTimestamp(thread.id),
        });
        seededMatchSentimentPosts += 1;

        if (slot < 2) {
          await ensurePost({
            content: homePositive
              ? "The momentum has felt real from kickoff. Even the quieter stretches have looked under control."
              : "I wanted more fight than this. The game has felt like it is drifting away every few minutes.",
            threadId: thread.id,
            authorId: homeAuthor.id,
            parentId: homePost.id,
            createdAt: nextPostTimestamp(thread.id),
          });
          seededMatchSentimentPosts += 1;

          await ensurePost({
            content: homePositive
              ? "From the away side, this has felt sloppy and underpowered. The passing lanes have never looked comfortable."
              : "From the away side, this has been encouraging. The adjustments and final-third intent look much stronger.",
            threadId: thread.id,
            authorId: awayAuthor.id,
            parentId: awayPost.id,
            createdAt: nextPostTimestamp(thread.id),
          });
          seededMatchSentimentPosts += 1;
        }
      }
    }

    console.log(`Seeded ${seededMatchSentimentPosts} sentiment-focused posts into the first two match threads`);
  }

  const pollTargets = [
    {
      thread: thread3,
      question: "Who will actually finish top of the league from here?",
      deadline: futureDate(10, 21, 0),
      options: ["Arsenal", "Liverpool", "Manchester City", "Someone else"],
      voterIndexes: [0, 1, 3, 4, 5, 8, 9, 12, 15, 18, 21, 24],
      votePattern: [0, 1, 2, 1, 0, 2, 1, 0, 1, 2, 0, 1],
    },
    {
      thread: thread5,
      question: "Which position is hardest to leave out of your best XI right now?",
      deadline: futureDate(8, 18, 30),
      options: ["Right wing", "Attacking midfield", "Centre-back", "Goalkeeper"],
      voterIndexes: [2, 6, 7, 10, 11, 13, 16, 17, 19, 22],
      votePattern: [0, 1, 0, 2, 1, 0, 3, 1, 0, 2],
    },
    {
      thread: thread7,
      question: "Who has the best chance of grabbing the last Champions League place?",
      deadline: futureDate(12, 20, 15),
      options: ["Chelsea", "Newcastle", "Spurs", "A surprise team"],
      voterIndexes: [0, 5, 7, 9, 14, 20, 23, 25, 27, 29, 31],
      votePattern: [1, 2, 1, 0, 1, 2, 0, 1, 2, 1, 3],
    },
    {
      thread: thread9,
      question: "Which young player has improved the fastest this season?",
      deadline: futureDate(9, 19, 45),
      options: ["Cole Palmer", "Kobbie Mainoo", "Jarrad Branthwaite", "Other"],
      voterIndexes: [1, 4, 6, 8, 12, 18, 26, 28, 30, 32],
      votePattern: [0, 1, 0, 2, 0, 1, 0, 3, 0, 1],
    },
    bestAtmosphereThread
      ? {
          thread: bestAtmosphereThread,
          question: "Which ground has delivered the loudest atmosphere lately?",
          deadline: futureDate(7, 22, 0),
          options: ["Anfield", "Selhurst Park", "St James' Park", "Emirates Stadium"],
          voterIndexes: [3, 5, 10, 11, 14, 16, 17, 20, 22, 24, 26, 28],
          votePattern: [1, 2, 1, 0, 2, 2, 0, 1, 2, 3, 2, 1],
        }
      : null,
    arsenalSupportersThread
      ? {
          thread: arsenalSupportersThread,
          question: "What should Arsenal prioritise next?",
          deadline: futureDate(11, 17, 50),
          options: ["Elite striker", "Wide forward depth", "Midfield balance", "Another defender"],
          voterIndexes: [0, 2, 3, 6, 9, 12, 15, 18, 21, 27, 30, 33],
          votePattern: [0, 0, 2, 0, 1, 0, 2, 1, 0, 0, 3, 1],
        }
      : null,
  ];

  let seededPollCount = 0;
  let seededPollVoteCount = 0;

  for (const target of pollTargets) {
    if (!target) continue;

    const authorId = target.thread.authorId;
    const pollResult = await ensurePoll({
      threadId: target.thread.id,
      authorId,
      question: target.question,
      deadline: target.deadline,
      options: target.options,
    });
    seededPollCount += 1;

    for (let index = 0; index < target.voterIndexes.length; index += 1) {
      const voter = activeSeedUsers[target.voterIndexes[index] % activeSeedUsers.length];
      if (!voter || voter.id === authorId) continue;

      const option = pollResult.options[target.votePattern[index] % pollResult.options.length];
      if (!option) continue;

      await ensurePollVote({
        userId: voter.id,
        pollOptionId: option.id,
      });
      seededPollVoteCount += 1;
    }
  }

  console.log(`Ensured ${seededPollCount} polls with ${seededPollVoteCount} votes`);

  // ─── Follows ─────────────────────────────────────────────────────────────
  await Promise.all([
    ensureFollow({
      followerId: users[0].id,
      followingId: users[1].id,
      createdAt: recentDate(44, 18, 20),
    }),
    ensureFollow({
      followerId: users[1].id,
      followingId: users[0].id,
      createdAt: recentDate(42, 19, 15),
    }),
    ensureFollow({
      followerId: users[2].id,
      followingId: users[0].id,
      createdAt: recentDate(37, 20, 5),
    }),
    ensureFollow({
      followerId: users[3].id,
      followingId: users[1].id,
      createdAt: recentDate(31, 18, 55),
    }),
    ensureFollow({
      followerId: users[4].id,
      followingId: users[2].id,
      createdAt: recentDate(28, 21, 25),
    }),
    ensureFollow({
      followerId: users[5].id,
      followingId: users[4].id,
      createdAt: recentDate(21, 19, 35),
    }),
    ensureFollow({
      followerId: users[6].id,
      followingId: users[3].id,
      createdAt: recentDate(16, 20, 10),
    }),
    ensureFollow({
      followerId: users[7].id,
      followingId: users[1].id,
      createdAt: recentDate(12, 18, 45),
    }),
    ensureFollow({
      followerId: users[8].id,
      followingId: users[3].id,
      createdAt: recentDate(10, 19, 20),
    }),
    ensureFollow({
      followerId: users[9].id,
      followingId: users[8].id,
      createdAt: recentDate(8, 20, 35),
    }),
    ensureFollow({
      followerId: users[10].id,
      followingId: users[4].id,
      createdAt: recentDate(7, 18, 55),
    }),
    ensureFollow({
      followerId: users[11].id,
      followingId: users[9].id,
      createdAt: recentDate(5, 21, 15),
    }),
    ensureFollow({
      followerId: users[12].id,
      followingId: users[1].id,
      createdAt: recentDate(3, 19, 45),
    }),
    ensureFollow({
      followerId: users[13].id,
      followingId: users[12].id,
      createdAt: recentDate(1, 20, 5),
    }),
  ]);

  console.log("Ensured follows");

  console.log("Seeding complete!");
  console.log("Admin login: admin@sportsdeck.com / admin123");
  console.log("User login:  harry@sportsdeck.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
