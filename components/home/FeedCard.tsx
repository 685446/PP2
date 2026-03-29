import { BellDot, CornerDownRight, MessageCircleMore, ShieldCheck, UserRound } from "lucide-react";
import type { HomeFeedItem } from "@/components/home/types";
import { DiscussionActivityCard, MatchActivityCard } from "@/components/shared/ActivityCards";
import { isSystemIdentity } from "@/lib/systemUser";

type FeedCardProps = {
  item: HomeFeedItem;
};

function FeedTypeIcon({ type }: { type: HomeFeedItem["type"] }) {
  if (type === "reply") return <MessageCircleMore className="h-4 w-4" />;
  if (type === "following") return <UserRound className="h-4 w-4" />;
  return <BellDot className="h-4 w-4" />;
}

function FeedTypeLabel({ type }: { type: HomeFeedItem["type"] }) {
  if (type === "reply") return "Replies";
  if (type === "following") return "Following";
  return "Team Update";
}

function PostRelationLine({ item }: { item: HomeFeedItem }) {
  if (item.originKind !== "post" || !item.postRelation) return null;

  const relationText =
    item.postRelation.kind === "replying-to"
      ? `Replying to ${item.postRelation.label}`
      : `In ${item.postRelation.label}`;

  return (
    <div className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs font-medium text-sky-500/90">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <span className="truncate">{relationText}</span>
    </div>
  );
}

function statusToBadgeLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "FINISHED") return "FT";
  if (normalized === "IN_PLAY") return "LIVE";
  if (normalized === "PAUSED") return "HT";
  if (normalized === "SCHEDULED" || normalized === "TIMED") return "Scheduled";
  return normalized;
}

function getEngagementCount(item: HomeFeedItem) {
  return item.engagement ? item.engagement.directCount : null;
}

function MatchUpdateCard({ item }: FeedCardProps) {
  if (!item.matchInfo) return null;

  const { homeTeam, awayTeam, score, status, matchWeek, leagueLabel } = item.matchInfo;
  const contextLine =
    matchWeek != null
      ? `Match Thread: ${homeTeam.name} vs ${awayTeam.name} | Matchweek ${matchWeek}`
      : `Match Thread: ${homeTeam.name} vs ${awayTeam.name}`;

  return (
    <MatchActivityCard
      href={item.href}
      ariaLabel={`${item.title}. ${contextLine}`}
      leagueLabel={leagueLabel}
      statusLabel={statusToBadgeLabel(status)}
      timeLabel={item.timestampLabel}
      homeTeam={{
        name: homeTeam.name,
        shortName: homeTeam.shortName,
        crestUrl: homeTeam.crestUrl,
      }}
      awayTeam={{
        name: awayTeam.name,
        shortName: awayTeam.shortName,
        crestUrl: awayTeam.crestUrl,
      }}
      homeScore={score.home}
      awayScore={score.away}
      headline={contextLine}
      count={getEngagementCount(item)}
    />
  );
}

function GenericFeedCard({ item }: FeedCardProps) {
  return (
    <DiscussionActivityCard
      href={item.href}
      ariaLabel={`${item.title}. ${item.summary}`}
      headerLeft={
        <div className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-500">
            <FeedTypeIcon type={item.type} />
            <FeedTypeLabel type={item.type} />
          </div>
          {item.isGrouped ? (
            <div className="inline-flex items-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
              Grouped
            </div>
          ) : null}
        </div>
      }
      timeLabel={item.timestampLabel}
      relation={<PostRelationLine item={item} />}
      title={item.title}
      summary={item.summary}
      summaryClassName={item.isGrouped ? "text-[color:var(--foreground)]/88" : undefined}
      footerLeft={
        <span className="inline-flex min-w-0 items-center gap-2">
          {item.contextCrestUrl ? (
            <img
              src={item.contextCrestUrl}
              alt={item.contextCrestAlt || "Team crest"}
              className="h-4 w-4 rounded-full object-contain"
            />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 text-sky-500/80" />
          )}
          <span className="truncate">{item.context}</span>
        </span>
      }
      count={getEngagementCount(item)}
    />
  );
}

function FollowingFeedCard({ item }: FeedCardProps) {
  const actorName = item.actor?.username || "Following user";
  const actorAvatar = item.actor?.avatar || null;
  const avatarFallback = actorName.slice(0, 1).toUpperCase();
  const systemIdentity = isSystemIdentity({
    username: item.actor?.username,
    avatar: actorAvatar,
  });

  return (
    <DiscussionActivityCard
      href={item.href}
      ariaLabel={`${item.title}. ${item.summary}`}
      headerLeft={
        <div className="inline-flex max-w-full min-w-0 items-center gap-2">
          {actorAvatar ? (
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-[color:var(--surface-border)] ${
                systemIdentity ? "bg-white p-1" : ""
              }`}
            >
              <img
                src={actorAvatar}
                alt=""
                className={`h-full w-full rounded-full ${
                  systemIdentity ? "object-contain" : "object-cover"
                }`}
              />
            </span>
          ) : (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--surface-elevated)] text-xs font-semibold text-[color:var(--foreground)]">
              {avatarFallback}
            </span>
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">{actorName}</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">Following</p>
          </div>
        </div>
      }
      timeLabel={item.timestampLabel}
      relation={<PostRelationLine item={item} />}
      title={item.title}
      summary={item.summary}
      footerLeft={
        <span className="inline-flex min-w-0 items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-500/80" />
          <span className="truncate">{item.context}</span>
        </span>
      }
      count={getEngagementCount(item)}
    />
  );
}

export default function FeedCard({ item }: FeedCardProps) {
  if (item.type === "team-update" && item.matchInfo) {
    return <MatchUpdateCard item={item} />;
  }

  if (item.type === "following") {
    return <FollowingFeedCard item={item} />;
  }

  return <GenericFeedCard item={item} />;
}
