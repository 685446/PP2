export type FeedItemType = "reply" | "following" | "team-update";

export type HomeFeedItem = {
  id: string;
  type: FeedItemType;
  isGrouped?: boolean;
  originKind?: "thread" | "post" | "match" | "user" | "other";
  postRelation?: {
    kind: "replying-to" | "in-thread";
    label: string;
  } | null;
  engagement?: {
    directCount: number;
    unit: "replies" | "posts";
  } | null;
  title: string;
  summary: string;
  context: string;
  contextCrestUrl?: string | null;
  contextCrestAlt?: string | null;
  actor?: {
    username: string;
    avatar: string | null;
  } | null;
  timestampLabel: string;
  createdAtMs: number;
  href: string;
  matchInfo?: {
    homeTeam: {
      name: string;
      shortName: string;
      crestUrl: string | null;
    };
    awayTeam: {
      name: string;
      shortName: string;
      crestUrl: string | null;
    };
    score: {
      home: number | null;
      away: number | null;
    };
    status: string;
    matchWeek: number | null;
    leagueLabel: string;
  };
};
