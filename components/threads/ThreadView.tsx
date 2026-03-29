"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Pencil,
  Search,
  CornerDownRight,
  Flag,
  History,
  Languages,
  LoaderCircle,
  Lock,
  LogIn,
  MessageSquare,
  Minus,
  Plus,
  Send,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import {
  SYSTEM_USER_BADGE,
  SYSTEM_USER_BIO,
  isSystemIdentity,
  isSystemUsername,
} from "@/lib/systemUser";
import {
  buildThreadBackNavigation,
  buildThreadHref,
  parseThreadSourceContext,
  type ThreadSourceContext,
} from "@/lib/threadLinks";

type ThreadAuthor = {
  id: number;
  username: string;
  avatar: string | null;
};

type ThreadTag = {
  tag: {
    id: number;
    name: string;
  };
};

type ThreadMatch = {
  id: number;
  utcDate: string;
  status: string;
};

type ThreadPollOption = {
  id: number;
  text: string;
  _count: {
    votes: number;
  };
};

type ThreadPoll = {
  id: number;
  question: string;
  deadline: string;
  authorId: number;
  currentUserVoteOptionId?: number | null;
  author: ThreadAuthor;
  options: ThreadPollOption[];
};

type ThreadPayload = {
  id: number;
  title: string;
  body: string;
  type: "GENERAL" | "TEAM" | "MATCH";
  createdAt: string;
  updatedAt: string;
  openAt: string;
  closedAt: string | null;
  author: ThreadAuthor;
  tags: ThreadTag[];
  match: ThreadMatch | null;
  poll: ThreadPoll | null;
  _count: {
    posts: number;
  };
};

type PostAuthor = {
  id: number;
  username: string;
  avatar: string | null;
} | null;

type PostEditPayload = {
  id: number;
  editedAt: string;
  content: string;
};

type CommentNodePayload = {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  author: PostAuthor;
  edits: PostEditPayload[];
  replies: CommentNodePayload[];
};

type PostPayload = CommentNodePayload;

type PostsPayload = {
  posts: PostPayload[];
  rootPostId?: number | null;
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
};

type ThreadState = {
  thread: ThreadPayload | null;
  posts: PostPayload[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  status: "loading" | "ready" | "error";
  error: string | null;
};

type ThreadViewProps = {
  threadId: string;
};

type CommentSortMode = "oldest" | "newest" | "replies";

type CommentSearchResult = {
  id: number;
  content: string;
  createdAt: string;
  isDeleted: boolean;
  author: PostAuthor;
  replyCount: number;
};

type ThreadTranslationState = {
  title: string;
  body: string;
  pollQuestion: string | null;
  pollOptions: string[];
};

type MatchSentimentState = {
  threadId: number;
  overall: string;
  totalPosts: number;
  homeTeam: {
    id: number;
    name: string;
    sentiment: string;
    fanPosts?: number;
  };
  awayTeam: {
    id: number;
    name: string;
    sentiment: string;
    fanPosts?: number;
  };
};

type ReportToastState = {
  tone: "success" | "error";
  message: string;
};

function toDateTimeLocalValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

const INITIAL_STATE: ThreadState = {
  thread: null,
  posts: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
  status: "loading",
  error: null,
};
const MAX_VISUAL_REPLY_DEPTH = 3;
const THREAD_GUIDE_GUTTER_PX = 28;
const THREAD_BRANCH_GAP_PX = 16;

async function fetchThreadData(
  threadId: number,
  options?: {
    signal?: AbortSignal;
    rootPostId?: number | null;
    page?: number;
    limit?: number;
    accessToken?: string | null;
  }
) {
  const { signal, rootPostId, page = 1, limit = 20, accessToken } = options || {};
  const postsUrl = new URL(`/api/threads/${threadId}/posts`, window.location.origin);
  postsUrl.searchParams.set("limit", String(limit));
  postsUrl.searchParams.set("page", String(page));
  if (rootPostId) {
    postsUrl.searchParams.set("rootPostId", String(rootPostId));
  }
  const [threadRes, postsRes] = await Promise.all([
    fetch(`/api/threads/${threadId}`, {
      signal,
      cache: "no-store",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    }),
    fetch(postsUrl.toString(), {
      signal,
      cache: "no-store",
    }),
  ]);

  if (!threadRes.ok) {
    const payload = (await threadRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Could not load thread.");
  }

  const thread = (await threadRes.json()) as ThreadPayload;
  const postsPayload = postsRes.ok
    ? ((await postsRes.json()) as PostsPayload)
    : ({ posts: [] } as PostsPayload);

  return {
    thread,
    posts: Array.isArray(postsPayload.posts) ? postsPayload.posts : [],
    page: typeof postsPayload.page === "number" ? postsPayload.page : page,
    limit: typeof postsPayload.limit === "number" ? postsPayload.limit : limit,
    total: typeof postsPayload.total === "number" ? postsPayload.total : 0,
    totalPages:
      typeof postsPayload.totalPages === "number"
        ? postsPayload.totalPages
        : 1,
  };
}

function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function isClosedMatchThread(thread: ThreadPayload): boolean {
  if (thread.type !== "MATCH" || !thread.closedAt) return false;
  const parsed = Date.parse(thread.closedAt);
  return !Number.isNaN(parsed) && parsed <= Date.now();
}

function isSystemAuthor(author: ThreadAuthor | PostAuthor) {
  return isSystemUsername(author?.username);
}

function getThreadAvailability(thread: ThreadPayload) {
  const now = Date.now();
  const openAt = Date.parse(thread.openAt);
  const closedAt = thread.closedAt ? Date.parse(thread.closedAt) : Number.NaN;
  const notOpenYet = !Number.isNaN(openAt) && openAt > now;
  const closed = !Number.isNaN(closedAt) && closedAt <= now;

  return {
    notOpenYet,
    closed,
    canPost: !notOpenYet && !closed,
  };
}

function countDescendantReplies(node: CommentNodePayload): number {
  return node.replies.reduce((total, reply) => total + 1 + countDescendantReplies(reply), 0);
}

function sortTopLevelComments(
  nodes: CommentNodePayload[],
  mode: CommentSortMode
): CommentNodePayload[] {
  const sorted = [...nodes];

  sorted.sort((left, right) => {
    if (mode === "newest") {
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    }

    if (mode === "replies") {
      const replyDelta = countDescendantReplies(right) - countDescendantReplies(left);
      if (replyDelta !== 0) return replyDelta;
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    }

    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });

  return sorted;
}

function collectSearchResults(
  nodes: CommentNodePayload[],
  query: string
): CommentSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const results: CommentSearchResult[] = [];

  const visit = (node: CommentNodePayload) => {
    const authorLabel = node.author?.username || "";
    const haystack = `${authorLabel} ${node.content}`.toLowerCase();

    if (haystack.includes(normalizedQuery)) {
      results.push({
        id: node.id,
        content: node.isDeleted ? "[removed]" : node.content,
        createdAt: node.createdAt,
        isDeleted: node.isDeleted,
        author: node.author,
        replyCount: countDescendantReplies(node),
      });
    }

    node.replies.forEach(visit);
  };

  nodes.forEach(visit);

  return results.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function ThreadTypeBadge({ type }: { type: ThreadPayload["type"] }) {
  const label = type === "MATCH" ? "Match Thread" : type === "TEAM" ? "Team Thread" : "General Thread";
  return (
    <span className="inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/12 px-3 py-1 text-xs font-semibold text-sky-600">
      {label}
    </span>
  );
}

function Avatar({ author }: { author: PostAuthor | ThreadAuthor }) {
  const avatarUrl = author?.avatar || null;
  const fallback = (author?.username?.slice(0, 1) || "?").toUpperCase();
  const systemIdentity = isSystemIdentity({
    username: author?.username,
    avatar: avatarUrl,
  });

  if (avatarUrl) {
    return (
      <span
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-[color:var(--surface-border)] ${
          systemIdentity ? "bg-white p-1" : ""
        }`}
      >
        <img
          src={avatarUrl}
          alt=""
          className={`h-full w-full rounded-full ${
            systemIdentity ? "object-contain" : "object-cover"
          }`}
        />
      </span>
    );
  }

  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--surface-elevated)] text-xs font-semibold text-[color:var(--foreground)]">
      {fallback}
    </span>
  );
}

function getAuthorProfileHref(author: PostAuthor | ThreadAuthor) {
  if (!author?.id || isSystemUsername(author.username)) {
    return null;
  }

  return `/users/${author.id}`;
}

function formatSentimentLabel(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "Neutral";
  if (normalized === "positive") return "Positive";
  if (normalized === "negative") return "Negative";
  if (normalized === "mixed") return "Mixed";
  if (normalized === "neutral") return "Neutral";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sentimentPillClass(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "positive") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  }
  if (normalized === "negative") {
    return "border-red-500/30 bg-red-500/10 text-red-700";
  }
  if (normalized === "mixed") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }
  return "border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--muted-foreground)]";
}

type CommentTreeNodeProps = {
  node: CommentNodePayload;
  depth: number;
  compactLayout: boolean;
  highlightedPostId: number | null;
  collapsedPosts: Record<number, boolean>;
  toggleCollapsedPost: (postId: number) => void;
  expandedEditHistory: Record<number, boolean>;
  toggleEditHistory: (postId: number) => void;
  session: StoredAuthSession | null;
  canUseReaderAiTools: boolean;
  canReply: boolean;
  editingPostId: number | null;
  setEditingPostId: React.Dispatch<React.SetStateAction<number | null>>;
  editDrafts: Record<number, string>;
  setEditDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  editPendingPostId: number | null;
  handleEditSubmit: (postId: number) => Promise<void>;
  replyParentId: number | null;
  setReplyParentId: React.Dispatch<React.SetStateAction<number | null>>;
  replyDrafts: Record<number, string>;
  setReplyDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  replyPendingParentId: number | null;
  handleReplySubmit: (parentId: number) => Promise<void>;
  deletePendingPostId: number | null;
  handleDeletePost: (postId: number) => Promise<void>;
  reportingPostId: number | null;
  setReportingPostId: React.Dispatch<React.SetStateAction<number | null>>;
  reportDrafts: Record<number, string>;
  setReportDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  reportPendingPostId: number | null;
  handleReportSubmit: (postId: number) => Promise<void>;
  translatedPosts: Record<number, string>;
  translatingPostId: number | null;
  handleTogglePostTranslation: (postId: number) => Promise<void>;
  clearReplyError: () => void;
  clearReportFeedback: () => void;
  threadAuthorId: number;
  threadId: number;
  threadSourceContext: ThreadSourceContext;
};

function CommentTreeNode({
  node,
  depth,
  compactLayout,
  highlightedPostId,
  collapsedPosts,
  toggleCollapsedPost,
  expandedEditHistory,
  toggleEditHistory,
  session,
  canUseReaderAiTools,
  canReply,
  editingPostId,
  setEditingPostId,
  editDrafts,
  setEditDrafts,
  editPendingPostId,
  handleEditSubmit,
  replyParentId,
  setReplyParentId,
  replyDrafts,
  setReplyDrafts,
  replyPendingParentId,
  handleReplySubmit,
  deletePendingPostId,
  handleDeletePost,
  reportingPostId,
  setReportingPostId,
  reportDrafts,
  setReportDrafts,
  reportPendingPostId,
  handleReportSubmit,
  translatedPosts,
  translatingPostId,
  handleTogglePostTranslation,
  clearReplyError,
  clearReportFeedback,
  threadAuthorId,
  threadId,
  threadSourceContext,
}: CommentTreeNodeProps) {
  const visualDepth = Math.min(depth, Math.max(MAX_VISUAL_REPLY_DEPTH - 1, 0));
  const isHighlighted = highlightedPostId === node.id;
  const isCollapsed = Boolean(collapsedPosts[node.id]);
  const hasReplies = node.replies.length > 0;
  const hideDeeperReplies = depth >= MAX_VISUAL_REPLY_DEPTH;
  const continuationReplyCount = hideDeeperReplies ? node.replies.length : 0;
  const visibleReplies = hideDeeperReplies ? [] : node.replies;
  const showReplyForm = replyParentId === node.id;
  const showEditForm = editingPostId === node.id;
  const canReplyToNode = !node.isDeleted;
  const canEdit =
    !node.isDeleted &&
    Boolean(session?.user && session.user.id === node.author?.id);
  const canDelete =
    !node.isDeleted &&
    Boolean(
      session?.user &&
        (session.user.role === "ADMIN" || session.user.id === node.author?.id)
    );
  const canReport =
    !node.isDeleted &&
    Boolean(session?.user && node.author?.id && session.user.id !== node.author.id);
  const showReportForm = reportingPostId === node.id;
  const branchIndentPx = compactLayout ? 18 : 24;
  const guideGutterPx = compactLayout ? 22 : THREAD_GUIDE_GUTTER_PX;
  const branchGapPx = compactLayout ? 12 : THREAD_BRANCH_GAP_PX;
  const nestedOffsetPx = Math.max(visualDepth, 1) * branchIndentPx;
  const guideColumnLeftPx = Math.max(visualDepth - 1, 0) * branchIndentPx;
  const guideLeftPx = guideColumnLeftPx + 12;
  const cardOffsetPx = nestedOffsetPx + guideGutterPx;
  const connectorWidthPx = Math.max(cardOffsetPx - guideLeftPx - 12, 10);
  const cardClass =
    depth === 0
      ? `rounded-2xl border bg-[color:var(--surface)] p-4 shadow-[0_8px_22px_rgba(2,8,23,0.06)] transition ${
          isHighlighted
            ? "border-sky-400/60 ring-1 ring-sky-500/40"
            : "border-[color:var(--surface-border)]"
        }`
      : `rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 shadow-[0_6px_16px_rgba(2,8,23,0.05)] transition ${
          isHighlighted
            ? "border-sky-400/60 ring-1 ring-sky-500/30"
            : ""
        }`;
  const actionButtonClass =
    depth === 0
      ? "btn-secondary"
      : "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-2.5 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]";
  const compactMetaClass =
    depth === 0
      ? "mt-4 flex flex-wrap items-center justify-between gap-2"
      : "mt-4 flex flex-wrap items-center gap-3 border-t border-[color:var(--surface-border)] pt-3";
  const authorLabel = node.isDeleted ? "[deleted]" : node.author?.username || "Deleted user";
  const contentLabel = node.isDeleted ? "[removed]" : node.content;
  const authorProfileHref = !node.isDeleted ? getAuthorProfileHref(node.author) : null;
  const translatedContent = translatedPosts[node.id];
  const isTranslated = Boolean(translatedContent);
  const displayedContent = translatedContent ?? contentLabel;
  const isOriginalPoster = !node.isDeleted && node.author?.id === threadAuthorId;
  const hasBeenEdited = node.edits.length > 0;
  const latestEditedAt = hasBeenEdited ? node.edits[0]?.editedAt : null;
  const showEditHistory = hasBeenEdited && Boolean(expandedEditHistory[node.id]);
  const branchSpacingClass = "space-y-4 pt-4";
  const replyBranch = !isCollapsed && hasReplies && (
    <div className={branchSpacingClass}>
      {visibleReplies.map((reply) => (
        <CommentTreeNode
          key={reply.id}
          node={reply}
          depth={depth + 1}
          compactLayout={compactLayout}
          highlightedPostId={highlightedPostId}
          collapsedPosts={collapsedPosts}
          toggleCollapsedPost={toggleCollapsedPost}
          expandedEditHistory={expandedEditHistory}
          toggleEditHistory={toggleEditHistory}
          session={session}
          canUseReaderAiTools={canUseReaderAiTools}
          canReply={canReply}
          editingPostId={editingPostId}
          setEditingPostId={setEditingPostId}
          editDrafts={editDrafts}
          setEditDrafts={setEditDrafts}
          editPendingPostId={editPendingPostId}
          handleEditSubmit={handleEditSubmit}
          replyParentId={replyParentId}
          setReplyParentId={setReplyParentId}
          replyDrafts={replyDrafts}
          setReplyDrafts={setReplyDrafts}
          replyPendingParentId={replyPendingParentId}
          handleReplySubmit={handleReplySubmit}
          deletePendingPostId={deletePendingPostId}
          handleDeletePost={handleDeletePost}
          reportingPostId={reportingPostId}
          setReportingPostId={setReportingPostId}
          reportDrafts={reportDrafts}
          setReportDrafts={setReportDrafts}
          reportPendingPostId={reportPendingPostId}
          handleReportSubmit={handleReportSubmit}
          translatedPosts={translatedPosts}
          translatingPostId={translatingPostId}
          handleTogglePostTranslation={handleTogglePostTranslation}
          clearReplyError={clearReplyError}
          clearReportFeedback={clearReportFeedback}
          threadAuthorId={threadAuthorId}
          threadId={threadId}
          threadSourceContext={threadSourceContext}
        />
      ))}
      {continuationReplyCount > 0 && (
        <Link
          href={buildThreadHref(threadId, threadSourceContext, {
            view: "single-comment",
            postId: node.id,
          })}
          scroll={false}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/8 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:border-sky-500/45 hover:bg-sky-500/12"
        >
          <Plus className="h-4 w-4" />
          More replies
        </Link>
      )}
    </div>
  );

  const card = (
    <div id={`post-${node.id}`} className={cardClass}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          {!node.isDeleted &&
            (node.author ? (
              authorProfileHref ? (
                <Link
                  href={authorProfileHref}
                  className="transition hover:opacity-85"
                  aria-label={`View ${node.author.username}'s profile`}
                >
                  <Avatar author={node.author} />
                </Link>
              ) : (
                <Avatar author={node.author} />
              )
            ) : (
              <UserRound className="h-3.5 w-3.5" />
            ))}
          {authorProfileHref ? (
            <Link
              href={authorProfileHref}
              className="font-medium text-[color:var(--foreground)] transition hover:text-sky-700"
            >
              {authorLabel}
            </Link>
          ) : (
            <span className={`font-medium ${node.isDeleted ? "italic text-[color:var(--muted-foreground)]" : "text-[color:var(--foreground)]"}`}>
              {authorLabel}
            </span>
          )}
          {!node.isDeleted && isSystemAuthor(node.author) && (
            <span
              className={`inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/12 font-semibold uppercase tracking-[0.12em] text-sky-600 ${
                depth === 0 ? "px-2 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[9px]"
              }`}
            >
              {SYSTEM_USER_BADGE}
            </span>
          )}
          {isOriginalPoster && (
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-sky-600">
              (OP)
            </span>
          )}
          {hasBeenEdited && latestEditedAt && (
            <span className="text-xs text-[color:var(--muted-foreground)]">
              Edited {formatDateTime(latestEditedAt)}
            </span>
          )}
        </div>
        <span className="text-xs text-[color:var(--muted-foreground)] sm:text-right">
          {formatDateTime(node.createdAt)}
        </span>
      </div>

      {showEditForm && !node.isDeleted ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={editDrafts[node.id] ?? node.content}
            onChange={(event) =>
              setEditDrafts((current) => ({
                ...current,
                [node.id]: event.target.value,
              }))
            }
            disabled={editPendingPostId === node.id}
            rows={3}
            className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-[color:var(--muted-foreground)]">
              {(editDrafts[node.id] ?? node.content).trim().length}/10000 characters
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setEditingPostId(null);
                  setEditDrafts((current) => {
                    const next = { ...current };
                    delete next[node.id];
                    return next;
                  });
                }}
                disabled={editPendingPostId === node.id}
                className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleEditSubmit(node.id)}
                disabled={
                  editPendingPostId === node.id ||
                  !((editDrafts[node.id] ?? node.content).trim())
                }
                className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {editPendingPostId === node.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {editPendingPostId === node.id ? "Saving..." : "Save edit"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p
          className={`mt-3 whitespace-pre-wrap ${
            node.isDeleted ? "italic text-[color:var(--muted-foreground)]" : "text-[color:var(--foreground)]"
          }`}
        >
          {displayedContent}
        </p>
      )}

      {showEditHistory && !showEditForm && (
        <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
            Edit history
          </p>
          <div className="mt-3 space-y-3">
            {node.edits.map((edit, index) => (
              <div
                key={edit.id}
                className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-3"
              >
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  Version {node.edits.length - index} â€¢ {formatDateTime(edit.editedAt)}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[color:var(--foreground)]">
                  {edit.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={compactMetaClass}>
        <span className="text-xs text-[color:var(--muted-foreground)]">
          {node.replies.length} {node.replies.length === 1 ? "reply" : "replies"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {hasReplies && (
            <button
              type="button"
              onClick={() => toggleCollapsedPost(node.id)}
              className={actionButtonClass}
            >
              {isCollapsed ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
              {isCollapsed ? "Expand" : "Collapse"}
            </button>
          )}
          {canReplyToNode && (
            <button
              type="button"
              onClick={() => {
                clearReplyError();
                setReplyParentId((current) => (current === node.id ? null : node.id));
              }}
              disabled={!session || !canReply}
              className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <CornerDownRight className="h-4 w-4" />
              Reply
            </button>
          )}
          {canUseReaderAiTools && !node.isDeleted && (
            <button
              type="button"
              onClick={() => void handleTogglePostTranslation(node.id)}
              disabled={translatingPostId === node.id}
              className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {translatingPostId === node.id ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Languages className="h-4 w-4" />
              )}
              {translatingPostId === node.id
                ? "Translating..."
                : isTranslated
                  ? "Show original"
                  : "Translate"}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                clearReplyError();
                setReplyParentId(null);
                setEditingPostId((current) => (current === node.id ? null : node.id));
                setEditDrafts((current) => ({
                  ...current,
                  [node.id]: current[node.id] ?? node.content,
                }));
              }}
              disabled={editPendingPostId === node.id}
              className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {editPendingPostId === node.id ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void handleDeletePost(node.id)}
              disabled={deletePendingPostId === node.id}
              className={`${actionButtonClass} text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {deletePendingPostId === node.id ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletePendingPostId === node.id ? "Deleting..." : "Delete"}
            </button>
          )}
          {hasBeenEdited && (
            <button
              type="button"
              onClick={() => toggleEditHistory(node.id)}
              className={actionButtonClass}
            >
              <History className="h-4 w-4" />
              {showEditHistory ? "Hide history" : `View history (${node.edits.length})`}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              onClick={() => {
                clearReportFeedback();
                setEditingPostId(null);
                setReplyParentId(null);
                setReportingPostId((current) => (current === node.id ? null : node.id));
                setReportDrafts((current) => ({
                  ...current,
                  [node.id]: current[node.id] ?? "",
                }));
              }}
              disabled={reportPendingPostId === node.id}
              className={`${actionButtonClass} text-amber-700 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {reportPendingPostId === node.id ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Flag className="h-4 w-4" />
              )}
              {reportPendingPostId === node.id ? "Reporting..." : "Report"}
            </button>
          )}
        </div>
      </div>

      {showReportForm && canReport && (
        <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
          <label className="block text-sm font-medium text-[color:var(--foreground)]">
            Tell moderators what is wrong with this comment
          </label>
          <textarea
            value={reportDrafts[node.id] || ""}
            onChange={(event) => {
              clearReportFeedback();
              setReportDrafts((current) => ({
                ...current,
                [node.id]: event.target.value,
              }));
            }}
            disabled={reportPendingPostId === node.id}
            placeholder="Briefly explain why this comment should be reviewed..."
            rows={3}
            maxLength={500}
            className="mt-3 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-amber-500/45 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-[color:var(--muted-foreground)]">
              {(reportDrafts[node.id] || "").trim().length}/500 characters
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => {
                  clearReportFeedback();
                  setReportingPostId(null);
                }}
                disabled={reportPendingPostId === node.id}
                className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleReportSubmit(node.id)}
                disabled={
                  reportPendingPostId === node.id ||
                  !(reportDrafts[node.id] || "").trim()
                }
                className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {reportPendingPostId === node.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Flag className="h-4 w-4" />
                )}
                {reportPendingPostId === node.id ? "Submitting..." : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReplyForm && canReplyToNode && (
        <div className="mt-4 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
          <textarea
            value={replyDrafts[node.id] || ""}
            onChange={(event) =>
              setReplyDrafts((current) => ({
                ...current,
                [node.id]: event.target.value,
              }))
            }
            disabled={!session || !canReply || replyPendingParentId === node.id}
            placeholder="Add a reply to this comment..."
            rows={3}
            className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-[color:var(--muted-foreground)]">
              {(replyDrafts[node.id] || "").trim().length}/10000 characters
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => setReplyParentId(null)}
                disabled={replyPendingParentId === node.id}
                className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleReplySubmit(node.id)}
                disabled={
                  !session ||
                  !canReply ||
                  replyPendingParentId === node.id ||
                  !(replyDrafts[node.id] || "").trim()
                }
                className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {replyPendingParentId === node.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {replyPendingParentId === node.id ? "Replying..." : "Reply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCollapsed && hasReplies && (
        <button
          type="button"
          onClick={() => toggleCollapsedPost(node.id)}
          className="mt-3 text-left text-sm text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
        >
          Collapsed branch. {node.replies.length} hidden {node.replies.length === 1 ? "reply" : "replies"}.
        </button>
      )}
    </div>
  );

  if (depth === 0) {
    return (
      <article>
        {card}
        {replyBranch}
      </article>
    );
  }

  return (
    <div
      className="relative"
      style={{
        paddingLeft: `${cardOffsetPx}px`,
      }}
    >
      <span
        className="absolute w-px bg-[color:var(--surface-border)] opacity-90"
        style={{
          left: `${guideLeftPx}px`,
          top: `${-branchGapPx}px`,
          bottom: `${-branchGapPx}px`,
        }}
      />
      <span
        className="absolute top-6 bg-[color:var(--surface-border)] opacity-90"
        style={{
          left: `${guideLeftPx}px`,
          width: `${connectorWidthPx}px`,
          height: "1px",
        }}
      />
      {card}
      {replyBranch}
    </div>
  );
}

export default function ThreadView({ threadId }: ThreadViewProps) {
  const searchParams = useSearchParams();
  const sourceContext = useMemo(
    () =>
      parseThreadSourceContext({
        source: searchParams.get("source"),
        communityTeamId: searchParams.get("communityTeamId"),
        event: searchParams.get("event"),
      }),
    [searchParams]
  );
  const { sourceKey, communityTeamId } = sourceContext;
  const highlightedPostId = useMemo(() => {
    const raw = searchParams.get("postId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }, [searchParams]);
  const hasPostFocus = highlightedPostId !== null;
  const singleCommentView =
    hasPostFocus &&
    (searchParams.get("view") === "single-comment" || sourceKey === "feed");

  const [state, setState] = useState<ThreadState>(INITIAL_STATE);
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [composerContent, setComposerContent] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerPending, setComposerPending] = useState(false);
  const [replyParentId, setReplyParentId] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<number, string>>({});
  const [replyError, setReplyError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [reportToast, setReportToast] = useState<ReportToastState | null>(null);
  const [replyPendingParentId, setReplyPendingParentId] = useState<number | null>(null);
  const [editPendingPostId, setEditPendingPostId] = useState<number | null>(null);
  const [reportingPostId, setReportingPostId] = useState<number | null>(null);
  const [reportDrafts, setReportDrafts] = useState<Record<number, string>>({});
  const [reportPendingPostId, setReportPendingPostId] = useState<number | null>(null);
  const [pollReportDraft, setPollReportDraft] = useState("");
  const [showPollReportForm, setShowPollReportForm] = useState(false);
  const [pollReportPending, setPollReportPending] = useState(false);
  const [pollVotePendingOptionId, setPollVotePendingOptionId] = useState<number | null>(null);
  const [pollVoteError, setPollVoteError] = useState<string | null>(null);
  const [votedPollOptionId, setVotedPollOptionId] = useState<number | null>(null);
  const [commentSearchDraft, setCommentSearchDraft] = useState("");
  const [commentSearchQuery, setCommentSearchQuery] = useState("");
  const [commentSort, setCommentSort] = useState<CommentSortMode>("oldest");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePendingPostId, setDeletePendingPostId] = useState<number | null>(null);
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [collapsedPosts, setCollapsedPosts] = useState<Record<number, boolean>>({});
  const [expandedEditHistory, setExpandedEditHistory] = useState<Record<number, boolean>>({});
  const [translatedThread, setTranslatedThread] = useState<ThreadTranslationState | null>(null);
  const [threadTranslationPending, setThreadTranslationPending] = useState(false);
  const [threadTranslationError, setThreadTranslationError] = useState<string | null>(null);
  const [translatedPosts, setTranslatedPosts] = useState<Record<number, string>>({});
  const [translatingPostId, setTranslatingPostId] = useState<number | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [matchSentiment, setMatchSentiment] = useState<MatchSentimentState | null>(null);
  const [matchSentimentPending, setMatchSentimentPending] = useState(false);
  const [matchSentimentError, setMatchSentimentError] = useState<string | null>(null);
  const [editingThread, setEditingThread] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [threadBodyDraft, setThreadBodyDraft] = useState("");
  const [threadActionPending, setThreadActionPending] = useState(false);
  const [threadActionError, setThreadActionError] = useState<string | null>(null);
  const [editingPoll, setEditingPoll] = useState(false);
  const [pollQuestionDraft, setPollQuestionDraft] = useState("");
  const [pollDeadlineDraft, setPollDeadlineDraft] = useState("");
  const [pollOptionDrafts, setPollOptionDrafts] = useState<string[]>([]);
  const [pollActionPending, setPollActionPending] = useState(false);
  const [pollActionError, setPollActionError] = useState<string | null>(null);
  const [compactThreadLayout, setCompactThreadLayout] = useState(false);
  const numericThreadId = Number(threadId);
  const canUseReaderAiTools = session?.user?.role === "USER";
  const visiblePosts = useMemo(() => {
    return sortTopLevelComments(state.posts, commentSort);
  }, [commentSort, state.posts]);
  const searchResults = useMemo(() => {
    return collectSearchResults(state.posts, commentSearchQuery);
  }, [commentSearchQuery, state.posts]);
  const showingSearchResults = !singleCommentView && commentSearchQuery.trim().length > 0;

  useEffect(() => {
    if (Number.isNaN(numericThreadId)) {
      setState({
        thread: null,
        posts: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
        status: "error",
        error: "Invalid thread id.",
      });
      return;
    }

    const controller = new AbortController();
    setState(INITIAL_STATE);

    const load = async () => {
      try {
        const data = await fetchThreadData(numericThreadId, {
          signal: controller.signal,
          rootPostId: singleCommentView ? highlightedPostId : null,
          page: 1,
          limit: 20,
          accessToken: loadAuthSession()?.accessToken ?? null,
        });

        if (controller.signal.aborted) return;

        setState({
          thread: data.thread,
          posts: data.posts,
          page: data.page,
          limit: data.limit,
          total: data.total,
          totalPages: data.totalPages,
          status: "ready",
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          thread: null,
          posts: [],
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 1,
          status: "error",
          error: error instanceof Error ? error.message : "Could not load thread.",
        });
      }
    };

    void load();

    return () => controller.abort();
  }, [highlightedPostId, numericThreadId, singleCommentView]);

  useEffect(() => {
    setSession(loadAuthSession());

    const syncSession = () => {
      setSession(loadAuthSession());
    };

    window.addEventListener(AUTH_CHANGED_EVENT, syncSession);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, syncSession);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const syncLayout = () => setCompactThreadLayout(mediaQuery.matches);

    syncLayout();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncLayout);
      return () => mediaQuery.removeEventListener("change", syncLayout);
    }

    mediaQuery.addListener(syncLayout);
    return () => mediaQuery.removeListener(syncLayout);
  }, []);

  useEffect(() => {
    if (!highlightedPostId || state.status !== "ready" || singleCommentView) return;
    const node = document.getElementById(`post-${highlightedPostId}`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedPostId, singleCommentView, state.status]);

  useEffect(() => {
    if (!singleCommentView || state.status !== "ready") return;

    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [singleCommentView, state.status]);

  useEffect(() => {
    setTranslatedThread(null);
    setThreadTranslationError(null);
    setTranslatedPosts({});
    setTranslationError(null);
    setMatchSentiment(null);
    setMatchSentimentError(null);
    setReportToast(null);
    setReportingPostId(null);
    setShowPollReportForm(false);
    setExpandedEditHistory({});
    setPollReportDraft("");
    setPollVotePendingOptionId(null);
    setPollVoteError(null);
    setVotedPollOptionId(null);
    setEditingThread(false);
    setThreadActionPending(false);
    setThreadActionError(null);
    setEditingPoll(false);
    setPollActionPending(false);
    setPollActionError(null);
  }, [numericThreadId, highlightedPostId, singleCommentView]);

  useEffect(() => {
    if (!reportToast) return;

    const timeoutId = window.setTimeout(() => {
      setReportToast(null);
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [reportToast]);

  const { href: backHref, label: backLabel } = buildThreadBackNavigation(sourceContext);

  const reloadThread = async () => {
    const activeSession = session?.accessToken ? session : loadAuthSession();
    const refreshed = await fetchThreadData(numericThreadId, {
      rootPostId: singleCommentView ? highlightedPostId : null,
      page: 1,
      limit: 20,
      accessToken: activeSession?.accessToken ?? null,
    });
    setState({
      thread: refreshed.thread,
      posts: refreshed.posts,
      page: refreshed.page,
      limit: refreshed.limit,
      total: refreshed.total,
      totalPages: refreshed.totalPages,
      status: "ready",
      error: null,
    });
    setTranslatedPosts({});
    setTranslationError(null);
    setVotedPollOptionId(refreshed.thread.poll?.currentUserVoteOptionId ?? null);
  };

  const handleStartThreadEdit = () => {
    if (!state.thread) return;
    setThreadActionError(null);
    setEditingThread(true);
    setThreadTitleDraft(state.thread.title);
    setThreadBodyDraft(state.thread.body);
  };

  const handleSaveThreadEdit = async () => {
    if (!state.thread) return;

    setThreadActionError(null);
    setThreadActionPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to edit threads.");
      }

      const title = threadTitleDraft.trim();
      const body = threadBodyDraft.trim();

      if (!title) {
        throw new Error("Thread title cannot be empty.");
      }

      if (!body) {
        throw new Error("Thread body cannot be empty.");
      }

      const response = await fetch(`/api/threads/${state.thread.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ title, body }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not update this thread.");
      }

      setEditingThread(false);
      await reloadThread();
    } catch (error) {
      setThreadActionError(
        error instanceof Error ? error.message : "Could not update this thread."
      );
    } finally {
      setThreadActionPending(false);
    }
  };

  const handleDeleteThread = async () => {
    if (!state.thread) return;

    const confirmed = window.confirm(
      "Delete this thread? It will be hidden from the discussion feed."
    );
    if (!confirmed) return;

    setThreadActionError(null);
    setThreadActionPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to delete threads.");
      }

      const response = await fetch(`/api/threads/${state.thread.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Could not delete this thread.");
      }

      window.location.href = backHref;
    } catch (error) {
      setThreadActionError(
        error instanceof Error ? error.message : "Could not delete this thread."
      );
    } finally {
      setThreadActionPending(false);
    }
  };

  const handleStartPollEdit = () => {
    if (!poll) return;
    setPollActionError(null);
    setEditingPoll(true);
    setPollQuestionDraft(poll.question);
    setPollDeadlineDraft(toDateTimeLocalValue(poll.deadline));
    setPollOptionDrafts(poll.options.map((option) => option.text));
  };

  const handleSavePollEdit = async () => {
    if (!poll) return;

    setPollActionError(null);
    setPollActionPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to edit polls.");
      }

      const question = pollQuestionDraft.trim();
      const deadline = pollDeadlineDraft ? new Date(pollDeadlineDraft).toISOString() : "";
      const options = pollOptionDrafts.map((option) => option.trim()).filter(Boolean);

      if (!question) {
        throw new Error("Poll question cannot be empty.");
      }

      if (!deadline) {
        throw new Error("Choose a poll deadline.");
      }

      const payload: {
        question: string;
        deadline: string;
        options?: string[];
      } = {
        question,
        deadline,
      };

      if (pollTotalVotes === 0) {
        payload.options = options;
      }

      const response = await fetch(`/api/polls/${poll.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const payloadResponse = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payloadResponse.error || "Could not update this poll.");
      }

      setEditingPoll(false);
      await reloadThread();
    } catch (error) {
      setPollActionError(error instanceof Error ? error.message : "Could not update this poll.");
    } finally {
      setPollActionPending(false);
    }
  };

  const handleDeletePoll = async () => {
    if (!poll) return;

    const confirmed = window.confirm("Delete this poll? This cannot be undone.");
    if (!confirmed) return;

    setPollActionError(null);
    setPollActionPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to delete polls.");
      }

      const response = await fetch(`/api/polls/${poll.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Could not delete this poll.");
      }

      setEditingPoll(false);
      setShowPollReportForm(false);
      setPollReportDraft("");
      await reloadThread();
    } catch (error) {
      setPollActionError(error instanceof Error ? error.message : "Could not delete this poll.");
    } finally {
      setPollActionPending(false);
    }
  };

  const handleToggleThreadTranslation = async (threadTitle: string, threadBody: string) => {
    const activeSession = await refreshAccessTokenIfNeeded();
    if (!activeSession || activeSession.user.role !== "USER") {
      setSession(activeSession ?? null);
      setThreadTranslationError("Sign in as a user to translate this thread.");
      return;
    }

    if (translatedThread) {
      setTranslatedThread(null);
      setThreadTranslationError(null);
      return;
    }

    setThreadTranslationError(null);
    setThreadTranslationPending(true);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ threadId: numericThreadId }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        translatedTitle?: string;
        translatedBody?: string;
        translatedPollQuestion?: string;
        translatedPollOptions?: string[];
      };

      if (!response.ok) {
        throw new Error(payload.error || "Could not translate this thread.");
      }

      setTranslatedThread({
        title: payload.translatedTitle || threadTitle,
        body: payload.translatedBody || threadBody,
        pollQuestion: payload.translatedPollQuestion || null,
        pollOptions: Array.isArray(payload.translatedPollOptions) ? payload.translatedPollOptions : [],
      });
    } catch (error) {
      setThreadTranslationError(
        error instanceof Error ? error.message : "Could not translate this thread."
      );
    } finally {
      setThreadTranslationPending(false);
    }
  };

  const handleTogglePostTranslation = async (postId: number) => {
    const activeSession = await refreshAccessTokenIfNeeded();
    if (!activeSession || activeSession.user.role !== "USER") {
      setSession(activeSession ?? null);
      setTranslationError("Sign in as a user to translate this comment.");
      return;
    }

    if (translatedPosts[postId]) {
      setTranslatedPosts((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      setTranslationError(null);
      return;
    }

    setTranslationError(null);
    setTranslatingPostId(postId);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ postId }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        translated?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Could not translate this comment.");
      }

      setTranslatedPosts((current) => ({
        ...current,
        [postId]: payload.translated || "",
      }));
    } catch (error) {
      setTranslationError(
        error instanceof Error ? error.message : "Could not translate this comment."
      );
    } finally {
      setTranslatingPostId(null);
    }
  };

  const handleToggleMatchSentiment = async () => {
    const activeSession = await refreshAccessTokenIfNeeded();
    if (!activeSession || activeSession.user.role !== "USER") {
      setSession(activeSession ?? null);
      setMatchSentimentError("Sign in as a user to view sentiment.");
      return;
    }

    if (matchSentiment) {
      setMatchSentiment(null);
      setMatchSentimentError(null);
      return;
    }

    setMatchSentimentError(null);
    setMatchSentimentPending(true);

    try {
      const response = await fetch(`/api/threads/${numericThreadId}/sentiment`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as
        | ({ error?: string } & Partial<MatchSentimentState>)
        | undefined;

      if (!response.ok) {
        throw new Error(payload?.error || "Could not analyze thread sentiment.");
      }

      setMatchSentiment(payload as MatchSentimentState);
    } catch (error) {
      setMatchSentimentError(
        error instanceof Error ? error.message : "Could not analyze thread sentiment."
      );
    } finally {
      setMatchSentimentPending(false);
    }
  };

  const handleLoadMoreComments = async () => {
    if (
      loadMorePending ||
      singleCommentView ||
      showingSearchResults ||
      state.status !== "ready" ||
      state.page >= state.totalPages
    ) {
      return;
    }

    setLoadMorePending(true);

    try {
      const nextPage = state.page + 1;
      const activeSession = session?.accessToken ? session : loadAuthSession();
      const nextSlice = await fetchThreadData(numericThreadId, {
        page: nextPage,
        limit: state.limit,
        accessToken: activeSession?.accessToken ?? null,
      });

      setState((current) => {
        const seen = new Set(current.posts.map((post) => post.id));
        const appended = nextSlice.posts.filter((post) => !seen.has(post.id));

        return {
          thread: nextSlice.thread,
          posts: [...current.posts, ...appended],
          page: nextSlice.page,
          limit: nextSlice.limit,
          total: nextSlice.total,
          totalPages: nextSlice.totalPages,
          status: "ready",
          error: null,
        };
      });
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not load more comments."
      );
    } finally {
      setLoadMorePending(false);
    }
  };

  const submitPost = async (content: string, parentId?: number) => {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error(parentId ? "Reply cannot be empty." : "Post cannot be empty.");
    }

    const activeSession = await refreshAccessTokenIfNeeded();
    setSession(activeSession);

    if (!activeSession) {
      throw new Error("Sign in to post or reply.");
    }

    const response = await fetch(`/api/threads/${numericThreadId}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeSession.accessToken}`,
      },
      body: JSON.stringify(parentId ? { content: trimmed, parentId } : { content: trimmed }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Could not submit your message.");
    }

    await reloadThread();
  };

  const handleComposerSubmit = async () => {
    setComposerError(null);
    setComposerPending(true);

    try {
      await submitPost(composerContent);
      setComposerContent("");
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not submit your post.");
    } finally {
      setComposerPending(false);
    }
  };

  const handleReplySubmit = async (parentId: number) => {
    setReplyError(null);
    setReplyPendingParentId(parentId);

    try {
      await submitPost(replyDrafts[parentId] || "", parentId);
      setReplyDrafts((current) => ({ ...current, [parentId]: "" }));
      setReplyParentId(null);
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "Could not submit your reply.");
    } finally {
      setReplyPendingParentId(null);
    }
  };

  const handleEditSubmit = async (postId: number) => {
    setEditError(null);
    setEditPendingPostId(postId);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to edit comments.");
      }

      const content = (editDrafts[postId] ?? "").trim();
      if (!content) {
        throw new Error("Comment cannot be empty.");
      }

      const response = await fetch(`/api/posts/${postId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ content }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not update this comment.");
      }

      setEditingPostId(null);
      setEditDrafts((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      await reloadThread();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not update this comment.");
    } finally {
      setEditPendingPostId(null);
    }
  };

  const handleDeletePost = async (postId: number) => {
    setDeleteError(null);
    const confirmed = window.confirm("Delete this comment? It will remain in the thread as [deleted].");
    if (!confirmed) return;

    setDeletePendingPostId(postId);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to delete comments.");
      }

      const response = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Could not delete this comment.");
      }

      setReplyParentId((current) => (current === postId ? null : current));
      setEditingPostId((current) => (current === postId ? null : current));
      setReplyDrafts((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      setEditDrafts((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      await reloadThread();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete this comment.");
    } finally {
      setDeletePendingPostId(null);
    }
  };

  const handleReportSubmit = async (postId: number) => {
    setReportToast(null);
    setReportPendingPostId(postId);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to report comments.");
      }

      const reason = (reportDrafts[postId] || "").trim();
      if (!reason) {
        throw new Error("Report reason cannot be empty.");
      }

      const response = await fetch(`/api/posts/${postId}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ reason }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not report this comment.");
      }

      setReportDrafts((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      setReportingPostId(null);
      showReportToast("success", "Comment reported. Moderators will review it.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not report this comment.";
      if (message.toLowerCase().includes("already reported")) {
        setReportingPostId(null);
      }
      showReportToast("error", message);
    } finally {
      setReportPendingPostId(null);
    }
  };

  const handlePollReportSubmit = async () => {
    if (!poll) return;

    setReportToast(null);
    setPollReportPending(true);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to report polls.");
      }

      const reason = pollReportDraft.trim();
      if (!reason) {
        throw new Error("Report reason cannot be empty.");
      }

      const response = await fetch(`/api/polls/${poll.id}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ reason }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not report this poll.");
      }

      setPollReportDraft("");
      setShowPollReportForm(false);
      showReportToast("success", "Poll reported. Moderators will review it.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not report this poll.";
      if (message.toLowerCase().includes("already reported")) {
        setShowPollReportForm(false);
      }
      showReportToast("error", message);
    } finally {
      setPollReportPending(false);
    }
  };

  const handlePollVote = async (optionId: number) => {
    if (!poll) return;

    setPollVoteError(null);
    setPollVotePendingOptionId(optionId);

    try {
      const activeSession = await refreshAccessTokenIfNeeded();
      setSession(activeSession);

      if (!activeSession) {
        throw new Error("Sign in to vote in polls.");
      }

      const response = await fetch(`/api/polls/${poll.id}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
        },
        body: JSON.stringify({ pollOptionId: optionId }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        poll?: {
          currentUserVoteOptionId?: number | null;
          options?: Array<{
            id: number;
            text: string;
            voteCount: number;
          }>;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error || "Could not submit your vote.");
      }

      setVotedPollOptionId(optionId);
      setState((current) => {
        if (!current.thread?.poll || !payload.poll?.options) {
          return current;
        }

        const nextOptions = payload.poll.options.map((option) => ({
          id: option.id,
          text: option.text,
          _count: {
            votes: option.voteCount,
          },
        }));

        return {
          ...current,
          thread: {
            ...current.thread,
            poll: {
              ...current.thread.poll,
              currentUserVoteOptionId: payload.poll.currentUserVoteOptionId ?? optionId,
              options: nextOptions,
            },
          },
        };
      });
    } catch (error) {
      setPollVoteError(error instanceof Error ? error.message : "Could not submit your vote.");
    } finally {
      setPollVotePendingOptionId(null);
    }
  };

  const toggleCollapsedPost = (postId: number) => {
    setCollapsedPosts((current) => ({
      ...current,
      [postId]: !current[postId],
    }));
  };

  const toggleEditHistory = (postId: number) => {
    setExpandedEditHistory((current) => ({
      ...current,
      [postId]: !current[postId],
    }));
  };

  if (state.status === "loading") {
    return (
      <section className="mx-auto w-full max-w-4xl space-y-4">
        <div className="h-10 w-44 animate-pulse rounded-xl bg-[color:var(--surface-elevated)]" />
        <div className="h-56 animate-pulse rounded-2xl bg-[color:var(--surface-elevated)]" />
        <div className="h-48 animate-pulse rounded-2xl bg-[color:var(--surface-elevated)]" />
      </section>
    );
  }

  if (state.status === "error" || !state.thread) {
    return (
      <section className="mx-auto w-full max-w-4xl space-y-4">
        <Link href={backHref} className="btn-secondary w-fit">
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-sm text-[color:var(--foreground)]">
          <p className="font-semibold">Could not open thread</p>
          <p className="mt-1 text-[color:var(--muted-foreground)]">{state.error || "This thread may be hidden or unavailable."}</p>
        </div>
      </section>
    );
  }

  const thread = state.thread;
  const closedMatchThread = isClosedMatchThread(thread);
  const matchStatus = thread.match?.status?.toUpperCase() ?? "";
  const matchHasFinished = ["FINISHED", "FT", "AET", "PEN"].includes(matchStatus);
  const matchThreadHeadline = closedMatchThread
    ? "This match thread is closed."
    : matchHasFinished
      ? "This post-match discussion is still open."
      : "This match thread is live.";
  const availability = getThreadAvailability(thread);
  const headlineTime = thread.type === "MATCH" ? thread.openAt : thread.createdAt;
  const systemAuthor = isSystemAuthor(thread.author);
  const poll = thread.poll;
  const displayedThreadTitle = translatedThread?.title || thread.title;
  const displayedThreadBody = translatedThread?.body || thread.body;
  const displayedPollQuestion =
    translatedThread?.pollQuestion && translatedThread.pollQuestion.trim()
      ? translatedThread.pollQuestion
      : poll?.question ?? "";
  const threadAuthorProfileHref = getAuthorProfileHref(thread.author);
  const pollIsOpen = poll ? Date.parse(poll.deadline) > Date.now() : false;
  const pollTotalVotes = poll
    ? poll.options.reduce((sum, option) => sum + option._count.votes, 0)
    : 0;
  const activePollVoteOptionId = votedPollOptionId ?? poll?.currentUserVoteOptionId ?? null;
  const canVoteInPoll = Boolean(poll && pollIsOpen && session?.user);
  const canManageThread = Boolean(
    session?.user &&
      (session.user.role === "ADMIN" || session.user.id === thread.author.id)
  );
  const canReportPoll = Boolean(
    poll &&
      session?.user &&
      session.user.id !== poll.authorId
  );
  const fullDiscussionHref = buildThreadHref(thread.id, sourceContext);
  const loginHref = `/login?next=${encodeURIComponent(fullDiscussionHref)}`;

  const canManagePoll = Boolean(
    poll &&
      session?.user &&
      (session.user.role === "ADMIN" || session.user.id === poll.authorId)
  );
  const canEditPoll = Boolean(canManagePoll && availability.canPost);

  const showReportToast = (tone: ReportToastState["tone"], message: string) => {
    setReportToast({ tone, message });
  };
  const clearReportFeedback = () => {
    setReportToast(null);
  };

  const handleCommentSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCommentSearchQuery(commentSearchDraft.trim());
  };

  const handleResetCommentSearch = () => {
    setCommentSearchDraft("");
    setCommentSearchQuery("");
  };

  return (
    <section className="mx-auto w-full max-w-4xl space-y-4">
      {reportToast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            className={`pointer-events-auto w-full max-w-md rounded-2xl border px-4 py-3 text-sm shadow-[0_16px_42px_rgba(15,23,42,0.18)] backdrop-blur ${
              reportToast.tone === "error"
                ? "border-red-400/35 bg-[color:var(--surface)] text-[color:var(--foreground)]"
                : "border-emerald-400/35 bg-[color:var(--surface)] text-[color:var(--foreground)]"
            }`}
          >
            {reportToast.message}
          </div>
        </div>
      )}

      <Link href={backHref} className="btn-secondary w-fit">
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      <article className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_8px_22px_rgba(2,8,23,0.06)] sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ThreadTypeBadge type={thread.type} />
          {closedMatchThread && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/12 px-3 py-1 text-xs font-semibold text-amber-700">
              <Lock className="h-3.5 w-3.5" />
              Closed
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
            <CalendarClock className="h-3.5 w-3.5" />
            {thread.type === "MATCH" ? `Opened ${formatDateTime(headlineTime)}` : formatDateTime(headlineTime)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
            <MessageSquare className="h-3.5 w-3.5" />
            {thread._count.posts} posts
          </span>
        </div>

        {editingThread ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
            <div>
              <label className="text-sm font-medium text-[color:var(--foreground)]">
                Thread title
              </label>
              <input
                type="text"
                value={threadTitleDraft}
                onChange={(event) => setThreadTitleDraft(event.target.value)}
                maxLength={200}
                disabled={threadActionPending}
                className="mt-2 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[color:var(--foreground)]">
                Thread body
              </label>
              <textarea
                value={threadBodyDraft}
                onChange={(event) => setThreadBodyDraft(event.target.value)}
                maxLength={10000}
                rows={6}
                disabled={threadActionPending}
                className="mt-2 min-h-[160px] w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[color:var(--muted-foreground)]">
                {threadBodyDraft.trim().length}/10000 characters
              </span>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setEditingThread(false);
                    setThreadActionError(null);
                  }}
                  disabled={threadActionPending}
                  className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveThreadEdit()}
                  disabled={
                    threadActionPending ||
                    !threadTitleDraft.trim() ||
                    !threadBodyDraft.trim()
                  }
                  className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {threadActionPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  {threadActionPending ? "Saving..." : "Save thread"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <h1 className="mt-3 break-words text-2xl font-bold text-[color:var(--foreground)] sm:text-3xl">
            {displayedThreadTitle}
          </h1>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          {threadAuthorProfileHref ? (
            <Link
              href={threadAuthorProfileHref}
              className="transition hover:opacity-85"
              aria-label={`View ${thread.author.username}'s profile`}
            >
              <Avatar author={thread.author} />
            </Link>
          ) : (
            <Avatar author={thread.author} />
          )}
          {threadAuthorProfileHref ? (
            <span className="min-w-0 break-words">
              by{" "}
              <Link
                href={threadAuthorProfileHref}
                className="font-medium text-[color:var(--foreground)] transition hover:text-sky-700"
              >
                {thread.author.username}
              </Link>
            </span>
          ) : (
            <span className="min-w-0 break-words">by {thread.author.username}</span>
          )}
          {systemAuthor && (
            <span className="inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-600">
              {SYSTEM_USER_BADGE}
            </span>
          )}
        </div>

        {systemAuthor && (
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">{SYSTEM_USER_BIO}</p>
        )}

        {thread.match && (
          <div className="mt-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center">
              <span>
                Match status:{" "}
                <span className="font-semibold text-[color:var(--foreground)]">
                  {thread.match.status}
                </span>
              </span>
              <span className="hidden opacity-60 sm:inline">|</span>
              <span>Kickoff: {formatDateTime(thread.match.utcDate)}</span>
            </div>
          </div>
        )}

        {thread.type === "MATCH" && (
          <div
            className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
              closedMatchThread
                ? "border-amber-500/25 bg-amber-500/10 text-[color:var(--foreground)]"
                : "border-emerald-500/25 bg-emerald-500/10 text-[color:var(--foreground)]"
            }`}
          >
            <p className="font-semibold">{matchThreadHeadline}</p>
            <p className="mt-1">
              Opened {formatDateTime(thread.openAt)}
              {thread.closedAt
                ? ` • ${closedMatchThread ? "Closed" : "Closes"} ${formatDateTime(thread.closedAt)}`
                : ""}
            </p>
          </div>
        )}

        {canUseReaderAiTools && thread.type === "MATCH" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleMatchSentiment()}
              disabled={matchSentimentPending}
              className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {matchSentimentPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              {matchSentimentPending
                ? "Analyzing..."
                : matchSentiment
                  ? "Hide sentiment"
                  : "Show sentiment"}
            </button>
          </div>
        )}

        {canUseReaderAiTools && matchSentiment && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                Overall Mood
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sentimentPillClass(matchSentiment.overall)}`}
                >
                  {formatSentimentLabel(matchSentiment.overall)}
                </span>
                <span className="text-xs text-[color:var(--muted-foreground)]">
                  {matchSentiment.totalPosts} analyzed posts
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                {matchSentiment.homeTeam.name}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sentimentPillClass(matchSentiment.homeTeam.sentiment)}`}
                >
                  {formatSentimentLabel(matchSentiment.homeTeam.sentiment)}
                </span>
                {typeof matchSentiment.homeTeam.fanPosts === "number" && (
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {matchSentiment.homeTeam.fanPosts} fan posts
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                {matchSentiment.awayTeam.name}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sentimentPillClass(matchSentiment.awayTeam.sentiment)}`}
                >
                  {formatSentimentLabel(matchSentiment.awayTeam.sentiment)}
                </span>
                {typeof matchSentiment.awayTeam.fanPosts === "number" && (
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {matchSentiment.awayTeam.fanPosts} fan posts
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {canUseReaderAiTools && matchSentimentError && (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
            {matchSentimentError}
          </div>
        )}

        {canUseReaderAiTools && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleThreadTranslation(thread.title, thread.body)}
              disabled={threadTranslationPending}
              className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {threadTranslationPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Languages className="h-4 w-4" />
              )}
              {threadTranslationPending
                ? "Translating..."
                : translatedThread
                  ? "Show original"
                  : "Translate"}
            </button>
          </div>
        )}

        {threadActionError && (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
            {threadActionError}
          </div>
        )}

        {!editingThread && (
          <p className="mt-4 whitespace-pre-wrap text-[color:var(--foreground)]">
            {displayedThreadBody}
          </p>
        )}

        {threadTranslationError && (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
            {threadTranslationError}
          </div>
        )}

        {poll && (
          <div
            className={`mt-4 rounded-xl border p-4 ${
              pollIsOpen
                ? "border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)]"
                : "border-amber-500/25 bg-[linear-gradient(180deg,rgba(251,191,36,0.08),rgba(255,255,255,0.65))]"
            }`}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                  Thread Poll
                </p>
                {editingPoll ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-[color:var(--foreground)]">
                        Poll question
                      </label>
                      <input
                        type="text"
                        value={pollQuestionDraft}
                        onChange={(event) => setPollQuestionDraft(event.target.value)}
                        maxLength={200}
                        disabled={pollActionPending}
                        className="mt-2 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-[color:var(--foreground)]">
                        Poll deadline
                      </label>
                      <input
                        type="datetime-local"
                        value={pollDeadlineDraft}
                        onChange={(event) => setPollDeadlineDraft(event.target.value)}
                        disabled={pollActionPending}
                        className="mt-2 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>

                    <div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label className="text-sm font-medium text-[color:var(--foreground)]">
                          Poll options
                        </label>
                        {pollTotalVotes > 0 && (
                          <span className="text-xs text-[color:var(--muted-foreground)]">
                            Options are locked after voting starts.
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-2">
                        {pollOptionDrafts.map((option, index) => (
                          <div key={`poll-option-edit-${index}`} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={option}
                              onChange={(event) =>
                                setPollOptionDrafts((current) =>
                                  current.map((currentOption, optionIndex) =>
                                    optionIndex === index ? event.target.value : currentOption
                                  )
                                )
                              }
                              disabled={pollActionPending || pollTotalVotes > 0}
                              className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            {pollOptionDrafts.length > 2 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPollOptionDrafts((current) =>
                                    current.filter((_, optionIndex) => optionIndex !== index)
                                  )
                                }
                                disabled={pollActionPending || pollTotalVotes > 0}
                                className="inline-flex items-center justify-center rounded-full border border-red-500/30 bg-red-500/8 p-2 text-red-600 transition hover:border-red-500/45 hover:bg-red-500/12 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={`Remove poll option ${index + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {pollOptionDrafts.length < 10 && pollTotalVotes === 0 && (
                        <button
                          type="button"
                          onClick={() => setPollOptionDrafts((current) => [...current, ""])}
                          disabled={pollActionPending}
                          className="mt-3 btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        >
                          <Plus className="h-4 w-4" />
                          Add option
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                    {displayedPollQuestion}
                  </h2>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                  <span>
                    Created by{" "}
                    <span className="font-medium text-[color:var(--foreground)]">
                      {poll.author.username}
                    </span>
                  </span>
                  <span>&middot;</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold uppercase tracking-[0.08em] ${
                      pollIsOpen
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                        : "border-amber-500/30 bg-amber-500/12 text-amber-700"
                    }`}
                  >
                    {!pollIsOpen && <Lock className="h-3 w-3" />}
                    {pollIsOpen ? "Open" : "Closed"}
                  </span>
                  <span>&middot;</span>
                  <span>{pollIsOpen ? "Closes" : "Closed"} {formatDateTime(poll.deadline)}</span>
                  <span>&middot;</span>
                  <span>{pollTotalVotes} total votes</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto">
                {canEditPoll && !editingPoll && (
                  <button
                    type="button"
                    onClick={handleStartPollEdit}
                    disabled={pollActionPending}
                    className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit poll
                  </button>
                )}
                {canManagePoll && (
                  <button
                    type="button"
                    onClick={() => void handleDeletePoll()}
                    disabled={pollActionPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 transition hover:border-red-500/45 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {pollActionPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {pollActionPending ? "Working..." : "Delete poll"}
                  </button>
                )}
                {canReportPoll && !editingPoll && (
                  <button
                    type="button"
                    onClick={() => {
                      setReportToast(null);
                      setReportingPostId(null);
                      setEditingPostId(null);
                      setReplyParentId(null);
                      setShowPollReportForm((current) => !current);
                    }}
                    disabled={pollReportPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 transition hover:border-amber-500/45 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {pollReportPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Flag className="h-4 w-4" />
                    )}
                    {pollReportPending ? "Reporting..." : "Report poll"}
                  </button>
                )}
              </div>
            </div>

            {pollActionError && (
              <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
                {pollActionError}
              </div>
            )}

            {editingPoll && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setEditingPoll(false);
                    setPollActionError(null);
                  }}
                  disabled={pollActionPending}
                  className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSavePollEdit()}
                  disabled={pollActionPending}
                  className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {pollActionPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {pollActionPending ? "Saving..." : "Save poll"}
                </button>
              </div>
            )}

            {!pollIsOpen && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-[color:var(--foreground)]">
                <p className="font-semibold">Final results</p>
                <p className="mt-1 text-[color:var(--muted-foreground)]">
                  Voting has ended for this poll. The results below are now locked.
                </p>
              </div>
            )}

            <div className="mt-4 grid gap-2">
              {poll.options.map((option, index) => {
                const percentage =
                  pollTotalVotes > 0
                    ? Math.round((option._count.votes / pollTotalVotes) * 100)
                    : 0;
                const votePending = pollVotePendingOptionId === option.id;
                const isVotedOption = activePollVoteOptionId === option.id;
                const highestVoteCount = poll.options.reduce(
                  (max, current) => Math.max(max, current._count.votes),
                  0
                );
                const isLeadingOption =
                  pollTotalVotes > 0 &&
                  option._count.votes === highestVoteCount &&
                  highestVoteCount > 0;

                return (
                  <div
                    key={option.id}
                    className={`rounded-xl border bg-[color:var(--surface)] px-3 py-3 transition ${
                      isVotedOption
                        ? "border-sky-500/45 ring-1 ring-sky-500/25"
                        : !pollIsOpen && isLeadingOption
                          ? "border-amber-500/35 ring-1 ring-amber-500/15"
                        : "border-[color:var(--surface-border)]"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <span className="break-words text-sm font-medium text-[color:var(--foreground)]">
                        {translatedThread?.pollOptions[index]?.trim()
                          ? translatedThread.pollOptions[index]
                          : option.text}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[color:var(--muted-foreground)]">
                          {option._count.votes} vote{option._count.votes === 1 ? "" : "s"}
                          {pollTotalVotes > 0 ? ` • ${percentage}%` : ""}
                        </span>
                        {isVotedOption && (
                          <span className="inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/12 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-600">
                            Your vote
                          </span>
                        )}
                        {!pollIsOpen && isLeadingOption && (
                          <span className="inline-flex items-center rounded-full border border-amber-500/35 bg-amber-500/12 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                            Top result
                          </span>
                        )}
                        {canVoteInPoll && (
                          <button
                            type="button"
                            onClick={() => void handlePollVote(option.id)}
                            disabled={Boolean(pollVotePendingOptionId) || isVotedOption}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-500/45 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            {votePending ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : isVotedOption ? (
                              <Minus className="h-3.5 w-3.5" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            {votePending
                              ? "Voting..."
                              : isVotedOption
                                ? "Selected"
                                : activePollVoteOptionId
                                  ? "Change vote"
                                  : "Vote"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {pollVoteError && (
              <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
                {pollVoteError}
              </div>
            )}

            {!session?.user && pollIsOpen && (
              <div className="mt-4 flex flex-col gap-2 text-sm text-[color:var(--muted-foreground)] sm:flex-row sm:flex-wrap sm:items-center">
                <span>Sign in to vote in this poll.</span>
                <Link href={loginHref} className="btn-secondary w-full justify-center sm:w-auto">
                  <LogIn className="h-4 w-4" />
                  Login
                </Link>
              </div>
            )}

            {activePollVoteOptionId && (
              <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">
                {pollIsOpen
                  ? "Your vote has been recorded. You can change it while the poll is still open."
                  : "This poll is closed. Your recorded vote is highlighted above."}
              </p>
            )}

            {showPollReportForm && canReportPoll && (
              <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
                <label className="block text-sm font-medium text-[color:var(--foreground)]">
                  Tell moderators what is wrong with this poll
                </label>
                <textarea
                  value={pollReportDraft}
                  onChange={(event) => {
                    setReportToast(null);
                    setPollReportDraft(event.target.value);
                  }}
                  disabled={pollReportPending}
                  placeholder="Briefly explain why this poll should be reviewed..."
                  rows={3}
                  maxLength={500}
                  className="mt-3 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-amber-500/45 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {pollReportDraft.trim().length}/500 characters
                  </span>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      onClick={() => {
                        clearReportFeedback();
                        setShowPollReportForm(false);
                      }}
                      disabled={pollReportPending}
                      className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePollReportSubmit()}
                      disabled={pollReportPending || !pollReportDraft.trim()}
                      className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {pollReportPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Flag className="h-4 w-4" />
                      )}
                      {pollReportPending ? "Submitting..." : "Submit report"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {thread.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {thread.tags.map((tagRef) => (
              <span
                key={tagRef.tag.id}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-1 text-xs font-medium text-[color:var(--muted-foreground)]"
              >
                <Tag className="h-3 w-3" />
                {tagRef.tag.name}
              </span>
            ))}
          </div>
        )}

        {canManageThread && !editingThread && (
          <div className="mt-5 flex justify-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleStartThreadEdit}
                disabled={threadActionPending}
                className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <MessageSquare className="h-4 w-4" />
                Edit thread
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteThread()}
                disabled={threadActionPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-500/45 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {threadActionPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {threadActionPending ? "Working..." : "Delete thread"}
              </button>
            </div>
          </div>
        )}
      </article>

      {!singleCommentView && (
        <section className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_8px_22px_rgba(2,8,23,0.06)] sm:p-5">
          {availability.closed ? (
            <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
              This thread is closed, so new posts and replies are disabled.
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[color:var(--foreground)]">Join the Thread</h2>
                  <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                    Drop a top-level post here, or reply directly under any post below.
                  </p>
                </div>
                {session?.user ? (
                  <span className="text-sm text-[color:var(--muted-foreground)]">
                    Posting as <span className="font-semibold text-[color:var(--foreground)]">{session.user.username}</span>
                  </span>
                ) : (
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                    <Link href={loginHref} className="btn-secondary w-full justify-center sm:w-auto">
                      <LogIn className="h-4 w-4" />
                      Login
                    </Link>
                    <Link href="/register" className="btn-primary w-full justify-center sm:w-auto">
                      Create Account
                    </Link>
                  </div>
                )}
              </div>

              {!session && (
                <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
                  Sign in to add posts and replies.
                </div>
              )}

              {availability.notOpenYet && (
                <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
                  This thread opens on {formatDateTime(thread.openAt)}. Posting will unlock then.
                </div>
              )}

              <div className="mt-4 space-y-3">
                <textarea
                  value={composerContent}
                  onChange={(event) => setComposerContent(event.target.value)}
                  disabled={!session || !availability.canPost || composerPending}
                  placeholder={
                    !session
                      ? "Sign in to join this thread."
                      : availability.notOpenYet
                        ? "Posting opens when the thread goes live."
                        : "Share your take with the rest of the thread..."
                  }
                  rows={4}
                  className="min-h-[120px] w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                />

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {composerContent.trim().length}/10000 characters
                  </span>
                  <button
                    type="button"
                    onClick={handleComposerSubmit}
                    disabled={!session || !availability.canPost || composerPending || !composerContent.trim()}
                    className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {composerPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {composerPending ? "Posting..." : "Post to Thread"}
                  </button>
                </div>

                {composerError && (
                  <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[color:var(--foreground)]">
                    {composerError}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className={singleCommentView ? "space-y-3 pb-28" : "space-y-3"}>
        {singleCommentView && highlightedPostId && (
          <div
            id="single-comment-thread"
            className="flex flex-col gap-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-semibold text-[color:var(--foreground)]">Single comment thread</p>
              <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                You are viewing a focused branch from the full discussion.
              </p>
            </div>
            <Link
              href={fullDiscussionHref}
              className="text-sm font-medium text-sky-600 transition hover:text-sky-700"
            >
              All comments
            </Link>
          </div>
        )}

        {!singleCommentView && (
          <div className="space-y-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3">
            {!showingSearchResults && (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <label className="flex flex-col gap-2 text-sm text-[color:var(--muted-foreground)] sm:flex-row sm:items-center">
                  <span>Sort by</span>
                  <select
                    value={commentSort}
                    onChange={(event) => setCommentSort(event.target.value as CommentSortMode)}
                    className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] outline-none transition focus:border-sky-500/45 focus:ring-2 focus:ring-sky-500/20"
                  >
                    <option value="oldest">Oldest</option>
                    <option value="newest">Newest</option>
                    <option value="replies">Most Replies</option>
                  </select>
                </label>
              </div>
            )}

            <form onSubmit={handleCommentSearchSubmit}>
              <label className="flex w-full min-w-0 items-center gap-2 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--muted-foreground)]">
                <Search className="h-4 w-4" />
                <input
                  type="search"
                  value={commentSearchDraft}
                  onChange={(event) => setCommentSearchDraft(event.target.value)}
                  placeholder="Search comments"
                  className="w-full bg-transparent text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted-foreground)]"
                />
              </label>
            </form>

            {showingSearchResults && (
              <button
                type="button"
                onClick={handleResetCommentSearch}
                className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)] transition hover:text-sky-700"
              >
                <ArrowLeft className="h-4 w-4" />
                All comments
              </button>
            )}
          </div>
        )}

        {showingSearchResults && searchResults.map((result) => (
          <Link
            key={result.id}
            href={buildThreadHref(thread.id, sourceContext, {
              view: "single-comment",
              postId: result.id,
            })}
            scroll={false}
            className="block rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 shadow-[0_8px_22px_rgba(2,8,23,0.06)] transition hover:border-sky-400/40 hover:shadow-[0_10px_28px_rgba(2,8,23,0.08)]"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              <span className="font-semibold text-[color:var(--foreground)]">
                {result.isDeleted ? "[deleted]" : result.author?.username || "Deleted user"}
              </span>
              <span>&middot;</span>
              <span>{formatDateTime(result.createdAt)}</span>
            </div>
            <p className={`mt-3 text-lg ${result.isDeleted ? "italic text-[color:var(--muted-foreground)]" : "text-[color:var(--foreground)]"}`}>
              {result.content}
            </p>
            <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">
              {result.replyCount} {result.replyCount === 1 ? "reply" : "replies"}
            </p>
          </Link>
        ))}

        {!showingSearchResults && visiblePosts.length === 0 && (
          <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 text-sm text-[color:var(--muted-foreground)]">
            {availability.closed ? "This thread is closed and has no posts." : "No posts yet."}
          </div>
        )}

        {showingSearchResults && searchResults.length === 0 && (
          <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-5 text-sm text-[color:var(--muted-foreground)]">
            No comments match your search.
          </div>
        )}

        {!showingSearchResults && visiblePosts.map((post) => (
          <CommentTreeNode
            key={post.id}
            node={post}
            depth={0}
            compactLayout={compactThreadLayout}
            highlightedPostId={highlightedPostId}
            collapsedPosts={collapsedPosts}
            toggleCollapsedPost={toggleCollapsedPost}
            expandedEditHistory={expandedEditHistory}
            toggleEditHistory={toggleEditHistory}
            session={session}
            canUseReaderAiTools={canUseReaderAiTools}
            canReply={availability.canPost}
            editingPostId={editingPostId}
            setEditingPostId={setEditingPostId}
            editDrafts={editDrafts}
            setEditDrafts={setEditDrafts}
            editPendingPostId={editPendingPostId}
            handleEditSubmit={handleEditSubmit}
            replyParentId={replyParentId}
            setReplyParentId={setReplyParentId}
            replyDrafts={replyDrafts}
            setReplyDrafts={setReplyDrafts}
            replyPendingParentId={replyPendingParentId}
            handleReplySubmit={handleReplySubmit}
            deletePendingPostId={deletePendingPostId}
            handleDeletePost={handleDeletePost}
            reportingPostId={reportingPostId}
            setReportingPostId={setReportingPostId}
            reportDrafts={reportDrafts}
            setReportDrafts={setReportDrafts}
            reportPendingPostId={reportPendingPostId}
            handleReportSubmit={handleReportSubmit}
            translatedPosts={translatedPosts}
            translatingPostId={translatingPostId}
            handleTogglePostTranslation={handleTogglePostTranslation}
            clearReplyError={() => setReplyError(null)}
            clearReportFeedback={clearReportFeedback}
            threadAuthorId={thread.author.id}
            threadId={numericThreadId}
            threadSourceContext={sourceContext}
          />
        ))}

        {!singleCommentView &&
          !showingSearchResults &&
          state.totalPages > 1 &&
          state.page < state.totalPages && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void handleLoadMoreComments()}
                disabled={loadMorePending}
                className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/8 px-4 py-2 text-sm font-medium text-sky-700 transition hover:border-sky-500/45 hover:bg-sky-500/12 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadMorePending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {loadMorePending ? "Loading..." : "Load more comments"}
              </button>
            </div>
          )}

        {replyError && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-[color:var(--foreground)]">
            {replyError}
          </div>
        )}

        {editError && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-[color:var(--foreground)]">
            {editError}
          </div>
        )}

        {deleteError && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-[color:var(--foreground)]">
            {deleteError}
          </div>
        )}

        {translationError && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-[color:var(--foreground)]">
            {translationError}
          </div>
        )}
      </section>
    </section>
  );
}


