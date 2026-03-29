export type ThreadSourceKey = "feed" | "community" | "community-general" | "discussions";

export type ThreadSourceInput = {
  source?: string | null;
  communityTeamId?: string | number | null;
  event?: string | null;
};

export type ThreadSourceContext = {
  sourceKey: ThreadSourceKey;
  communityTeamId: string | null;
  event: string | null;
};

export type ThreadFocusInput = {
  view?: string | null;
  postId?: string | number | null;
};

function normalizePositiveIntegerString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(Math.trunc(parsed));
}

function normalizeEvent(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseThreadSourceContext({
  source,
  communityTeamId,
  event,
}: ThreadSourceInput): ThreadSourceContext {
  const normalizedTeamId = normalizePositiveIntegerString(communityTeamId);
  const normalizedEvent = normalizeEvent(event);

  if (source === "feed") {
    return {
      sourceKey: "feed",
      communityTeamId: null,
      event: normalizedEvent,
    };
  }

  if (source === "community" && normalizedTeamId) {
    return {
      sourceKey: "community",
      communityTeamId: normalizedTeamId,
      event: normalizedEvent,
    };
  }

  if (source === "community-general") {
    return {
      sourceKey: "community-general",
      communityTeamId: null,
      event: normalizedEvent,
    };
  }

  return {
    sourceKey: "discussions",
    communityTeamId: null,
    event: normalizedEvent,
  };
}

function resolveThreadSourceContext(input: ThreadSourceInput | ThreadSourceContext): ThreadSourceContext {
  if ("sourceKey" in input) {
    return parseThreadSourceContext({
      source: input.sourceKey,
      communityTeamId: input.communityTeamId,
      event: input.event,
    });
  }

  return parseThreadSourceContext(input);
}

export function buildThreadQuery(
  sourceInput: ThreadSourceInput | ThreadSourceContext,
  focus?: ThreadFocusInput
): string {
  const context = resolveThreadSourceContext(sourceInput);
  const params = new URLSearchParams();

  params.set("source", context.sourceKey);
  if (context.sourceKey === "community" && context.communityTeamId) {
    params.set("communityTeamId", context.communityTeamId);
  }
  if (context.event) {
    params.set("event", context.event);
  }

  const normalizedView = focus?.view?.trim();
  if (normalizedView) {
    params.set("view", normalizedView);
  }

  const normalizedPostId = normalizePositiveIntegerString(focus?.postId);
  if (normalizedPostId) {
    params.set("postId", normalizedPostId);
  }

  return params.toString();
}

export function buildThreadHref(
  threadId: string | number,
  sourceInput: ThreadSourceInput | ThreadSourceContext,
  focus?: ThreadFocusInput
): string {
  const query = buildThreadQuery(sourceInput, focus);
  return `/threads/${encodeURIComponent(String(threadId))}?${query}`;
}

export function buildThreadBackNavigation(sourceInput: ThreadSourceInput | ThreadSourceContext): {
  href: string;
  label: string;
} {
  const context = resolveThreadSourceContext(sourceInput);

  if (context.sourceKey === "feed") {
    return {
      href: "/",
      label: "Back to Home Feed",
    };
  }

  if (context.sourceKey === "community" && context.communityTeamId) {
    return {
      href: `/communities/${context.communityTeamId}`,
      label: "Back to Community",
    };
  }

  if (context.sourceKey === "community-general") {
    return {
      href: "/communities/general",
      label: "Back to Community",
    };
  }

  return {
    href: "/discussions",
    label: "Back to Discussions",
  };
}
