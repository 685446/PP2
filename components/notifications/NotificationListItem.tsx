"use client";

import Link from "next/link";
import { ChevronRight, MessageSquare, Trophy, UserPlus, Users } from "lucide-react";
import type { HomeFeedItem } from "@/components/home/types";

type NotificationListItemProps = {
  item: HomeFeedItem;
  compact?: boolean;
  onNavigate?: () => void;
};

function NotificationTypeIcon({ item }: { item: HomeFeedItem }) {
  if (item.originKind === "user") {
    return <UserPlus className="h-4 w-4 text-violet-500" />;
  }

  const { type } = item;
  if (type === "reply") {
    return <MessageSquare className="h-4 w-4 text-sky-500" />;
  }
  if (type === "following") {
    return <Users className="h-4 w-4 text-emerald-500" />;
  }
  return <Trophy className="h-4 w-4 text-amber-500" />;
}

export default function NotificationListItem({
  item,
  compact = false,
  onNavigate,
}: NotificationListItemProps) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group block rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] transition hover:border-sky-400/40 hover:bg-[color:var(--surface-elevated)] ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]">
          <NotificationTypeIcon item={item} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className={`min-w-0 truncate font-semibold text-[color:var(--foreground)] ${compact ? "text-sm" : "text-base"}`}>
              {item.title}
            </p>
            <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
              {item.timestampLabel}
            </span>
          </div>

          <p className={`mt-1 text-[color:var(--muted-foreground)] ${compact ? "line-clamp-1 text-xs" : "line-clamp-2 text-sm"}`}>
            {item.summary}
          </p>

          <p className={`mt-2 text-[color:var(--muted-foreground)] ${compact ? "text-xs" : "text-sm"}`}>
            {item.context}
          </p>
        </div>

        {!compact && (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[color:var(--muted-foreground)] transition group-hover:text-sky-500" />
        )}
      </div>
    </Link>
  );
}
