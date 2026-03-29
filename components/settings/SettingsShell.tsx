"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
import {
  BadgeAlert,
  Monitor,
  Moon,
  Palette,
  Settings,
  Shield,
  Sparkles,
  Sun,
  UserCircle2,
} from "lucide-react";
import {
  AUTH_CHANGED_EVENT,
  loadAuthSession,
  patchStoredAuthUser,
  refreshAccessTokenIfNeeded,
  type StoredAuthSession,
} from "@/components/auth/session";
import {
  THEME_CHANGED_EVENT,
  getStoredThemePreference,
  initThemeFromStorage,
  resolveTheme,
  setThemePreference,
  type ThemePreference,
} from "@/components/theme/theme";

type SettingsTabKey = "profile" | "appearance" | "account" | "moderation" | "about";
type ProfileField = "username" | "avatar" | "favoriteTeamId";
type AccountPasswordField = "currentPassword" | "newPassword" | "confirmPassword";
type AppealField = "reason";

type ProfileFormValues = {
  username: string;
  avatar: string;
  favoriteTeamId: string;
};

type AccountPasswordValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type TeamOption = {
  id: number;
  name: string;
};

type ModerationVerdict =
  | "LIKELY_INAPPROPRIATE"
  | "REVIEW_RECOMMENDED"
  | "LIKELY_APPROPRIATE"
  | "UNAVAILABLE";

const POLL_REPORT_PREFIX = "Poll report:";
const DEFAULT_USER_REPORT_SUSPENSION_DAYS = 7;
const MAX_USER_REPORT_SUSPENSION_DAYS = 365;

type ReportFilterTarget = "" | "POST" | "THREAD" | "USER" | "POLL";

type AdminReport = {
  id: number;
  targetType?: "POST" | "THREAD" | "USER";
  reason: string;
  createdAt: string;
  status: "PENDING" | "APPROVED" | "DISMISSED";
  reportCount: number;
  associatedThreadId: number | null;
  reporter?: {
    id: number;
    username: string;
    avatar?: string | null;
  } | null;
  post?: {
    id: number;
    content: string;
    threadId?: number | null;
    author?: {
      id: number;
      username: string;
    } | null;
  } | null;
  thread?: {
    id: number;
    title: string;
    body?: string | null;
    isHidden?: boolean;
    poll?: {
      question: string;
    } | null;
    author?: {
      id: number;
      username: string;
    } | null;
  } | null;
  reportedUser?: {
    id: number;
    username: string;
    status?: "ACTIVE" | "SUSPENDED" | "BANNED";
    statusReason?: string | null;
    suspendedUntil?: string | null;
  } | null;
  aiVerdict?: {
    verdict: ModerationVerdict;
    explanation?: string | null;
    toxicityScore?: number | null;
    threshold?: number | null;
    model?: string | null;
  } | null;
};

type AdminAppeal = {
  id: number;
  reason: string;
  createdAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  user: {
    id: number;
    username: string;
    avatar?: string | null;
    status: "ACTIVE" | "SUSPENDED" | "BANNED";
    statusReason?: string | null;
  };
};

type AppealFormValues = {
  reason: string;
};

type PendingAppeal = {
  id: number;
  reason: string;
  status: "PENDING";
  createdAt: string;
};

type SettingsTab = {
  key: SettingsTabKey;
  label: string;
  description: string;
};

const AUTH_TABS: SettingsTab[] = [
  {
    key: "profile",
    label: "Profile",
    description: "Edit username, avatar, and favorite team details.",
  },
  {
    key: "appearance",
    label: "Appearance",
    description: "Control theme, layout density, and viewing preferences.",
  },
  {
    key: "account",
    label: "Account",
    description: "Manage account-level actions and session controls.",
  },
  {
    key: "moderation",
    label: "Moderation",
    description: "Review reports, resolve appeals, and manage admin queues.",
  },
  {
    key: "about",
    label: "About",
    description: "View app info, support links, and project credits.",
  },
];

const GUEST_TABS: SettingsTab[] = [
  {
    key: "appearance",
    label: "Appearance",
    description: "Choose your default look and feel before signing in.",
  },
  {
    key: "about",
    label: "About",
    description: "View app info, support links, and project credits.",
  },
];

const TAB_COPY: Record<
  SettingsTabKey,
  { title: string; intro: string; bullets: [string, string, string] }
> = {
  profile: {
    title: "Profile Settings",
    intro:
      "Update your public profile details used across discussions, feeds, and matchday threads.",
    bullets: [
      "Update display identity (username and avatar).",
      "Select or change your favorite Premier League team.",
      "Preview profile changes before saving.",
    ],
  },
  appearance: {
    title: "Appearance Settings",
    intro:
      "Customize the app presentation so browsing forums and match pages stays comfortable.",
    bullets: [
      "Choose theme mode: dark, light, or system default.",
      "Set a consistent look across desktop and mobile.",
      "Apply visual preferences instantly without reloads.",
    ],
  },
  account: {
    title: "Security & Account",
    intro:
      "Manage sign-in security and essential account controls in one place.",
    bullets: [
      "Confirm your sign-in identity and account health.",
      "Update your password for account security.",
      "Review session guidance for safe account access.",
    ],
  },
  moderation: {
    title: "Moderation Console",
    intro:
      "Review pending reports and appeals, resolve queue items, and keep community moderation moving.",
    bullets: [
      "Sort the admin report queue by risk and volume.",
      "Approve or dismiss reports without leaving settings.",
      "Review user appeals and lift restrictions when appropriate.",
    ],
  },
  about: {
    title: "About SportsDeck",
    intro:
      "Learn what SportsDeck offers, how platform data is sourced, and where to find help.",
    bullets: [
      "Understand core community features in one place.",
      "Review provider transparency and AI-assisted feature notes.",
      "See design and asset credits used in the app.",
    ],
  },
};

const DEFAULT_AVATARS = [
  "/avatars/default1.png",
  "/avatars/default2.png",
  "/avatars/default3.png",
  "/avatars/default4.png",
  "/avatars/default5.png",
  "/avatars/default6.png",
] as const;

const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
const UNSAVED_PROFILE_CHANGES_MESSAGE =
  "You have unsaved profile changes. Leave without saving?";
const INTERACTIVE_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface)]";

const ABOUT_FEATURES = [
  "Follow matchdays through fixtures, standings, and team-focused discussions.",
  "Join community threads, vote in polls, and keep track of your favorite team.",
  "Use profile, follow, and feed features to personalize your SportsDeck experience.",
] as const;

const ABOUT_SAFETY = [
  "Report inappropriate posts or threads directly from discussion pages.",
  "Moderation combines user reports with AI-assisted signals to surface risky content.",
  "Hidden or moderated content is restricted from further activity for community safety.",
] as const;

const ABOUT_LINKS = [
  {
    label: "football-data.org (match and standings data)",
    href: "https://www.football-data.org/",
  },
  {
    label: "Hugging Face Inference API (AI translation and analysis)",
    href: "https://huggingface.co/",
  },
  {
    label: "Freepik (default avatar icons)",
    href: "https://www.freepik.com/",
  },
] as const;

function isPollReport(report: Pick<AdminReport, "targetType" | "post" | "reason">) {
  return (
    report.targetType === "THREAD" &&
    !report.post &&
    typeof report.reason === "string" &&
    report.reason.startsWith(POLL_REPORT_PREFIX)
  );
}

function TabIcon({ keyName }: { keyName: SettingsTabKey }) {
  if (keyName === "profile") return <UserCircle2 className="h-4 w-4" />;
  if (keyName === "appearance") return <Palette className="h-4 w-4" />;
  if (keyName === "account") return <Shield className="h-4 w-4" />;
  if (keyName === "moderation") return <BadgeAlert className="h-4 w-4" />;
  if (keyName === "about") return <Sparkles className="h-4 w-4" />;
  return <Settings className="h-4 w-4" />;
}

function ThemeOptionIcon({ option }: { option: ThemePreference }) {
  if (option === "light") return <Sun className="h-4 w-4" />;
  if (option === "dark") return <Moon className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

function toProfileFormValues(input: {
  username?: unknown;
  avatar?: unknown;
  favoriteTeamId?: unknown;
}): ProfileFormValues {
  return {
    username: typeof input.username === "string" ? input.username : "",
    avatar: typeof input.avatar === "string" ? input.avatar : "",
    favoriteTeamId:
      typeof input.favoriteTeamId === "number" && Number.isFinite(input.favoriteTeamId)
        ? String(input.favoriteTeamId)
        : "",
  };
}

function parseApiError(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function isKnownSettingsTabKey(value: string | null): value is SettingsTabKey {
  if (!value) return false;
  return (
    AUTH_TABS.some((tab) => tab.key === value) ||
    GUEST_TABS.some((tab) => tab.key === value)
  );
}

export default function SettingsShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authHydrated, setAuthHydrated] = useState(false);
  const [authSession, setAuthSession] = useState<StoredAuthSession | null>(null);
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");
  const [profileValues, setProfileValues] = useState<ProfileFormValues>({
    username: "",
    avatar: "",
    favoriteTeamId: "",
  });
  const [initialProfileValues, setInitialProfileValues] =
    useState<ProfileFormValues>({
      username: "",
      avatar: "",
      favoriteTeamId: "",
    });
  const [profileErrors, setProfileErrors] = useState<
    Partial<Record<ProfileField, string>>
  >({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaveState, setProfileSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [avatarUploadState, setAvatarUploadState] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [avatarUploadNotice, setAvatarUploadNotice] = useState<string | null>(null);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [accountValues, setAccountValues] = useState<AccountPasswordValues>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [accountErrors, setAccountErrors] = useState<
    Partial<Record<AccountPasswordField, string>>
  >({});
  const [accountSaveState, setAccountSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [appealValues, setAppealValues] = useState<AppealFormValues>({ reason: "" });
  const [appealErrors, setAppealErrors] = useState<Partial<Record<AppealField, string>>>(
    {}
  );
  const [pendingAppeal, setPendingAppeal] = useState<PendingAppeal | null>(null);
  const [pendingAppealLoading, setPendingAppealLoading] = useState(false);
  const [appealSaveState, setAppealSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [appealNotice, setAppealNotice] = useState<string | null>(null);
  const [reportsStatus, setReportsStatus] = useState<"PENDING" | "APPROVED" | "DISMISSED">(
    "PENDING"
  );
  const [reportsTargetType, setReportsTargetType] = useState<ReportFilterTarget>("");
  const [reportsAiVerdict, setReportsAiVerdict] = useState<"" | ModerationVerdict>("");
  const [reportsSortBy, setReportsSortBy] = useState<"aiVerdict" | "reportCount" | "createdAt">(
    "aiVerdict"
  );
  const [reportsSortOrder, setReportsSortOrder] = useState<"asc" | "desc">("desc");
  const [reportsQueue, setReportsQueue] = useState<AdminReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsNotice, setReportsNotice] = useState<string | null>(null);
  const [reportsActionKey, setReportsActionKey] = useState<string | null>(null);
  const [reportSuspensionDaysById, setReportSuspensionDaysById] = useState<
    Record<number, string>
  >({});
  const [reportModerationReasonById, setReportModerationReasonById] = useState<
    Record<number, string>
  >({});
  const reportsScrollRestoreYRef = useRef<number | null>(null);
  const [appealsStatus, setAppealsStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">(
    "PENDING"
  );
  const [appealsQueue, setAppealsQueue] = useState<AdminAppeal[]>([]);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealsNotice, setAppealsNotice] = useState<string | null>(null);
  const [appealsActionKey, setAppealsActionKey] = useState<string | null>(null);
  const appealsScrollRestoreYRef = useRef<number | null>(null);

  function rememberScrollPosition(ref: MutableRefObject<number | null>) {
    if (typeof window === "undefined") return;
    ref.current = window.scrollY;
  }

  useEffect(() => {
    if (reportsTargetType === "USER" && reportsAiVerdict) {
      setReportsAiVerdict("");
    }
  }, [reportsAiVerdict, reportsTargetType]);

  useEffect(() => {
    if (reportsLoading || reportsScrollRestoreYRef.current === null) return;

    const scrollY = reportsScrollRestoreYRef.current;
    reportsScrollRestoreYRef.current = null;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY });
    });
  }, [reportsLoading]);

  useEffect(() => {
    if (appealsLoading || appealsScrollRestoreYRef.current === null) return;

    const scrollY = appealsScrollRestoreYRef.current;
    appealsScrollRestoreYRef.current = null;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY });
    });
  }, [appealsLoading]);

  useEffect(() => {
    let cancelled = false;

    const syncAuth = async () => {
      const refreshed = await refreshAccessTokenIfNeeded();
      const session = refreshed ?? loadAuthSession();
      if (cancelled) return;

      setAuthSession(session);
      setIsAuthenticated(Boolean(session));
      setAuthHydrated(true);
    };

    void syncAuth();
    const onAuthChange = () => {
      void syncAuth();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChange);
    window.addEventListener("storage", onAuthChange);

    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChange);
      window.removeEventListener("storage", onAuthChange);
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => {
      const { preference, resolved } = initThemeFromStorage();
      setThemePreferenceState(preference);
      setResolvedTheme(resolved);
    };

    syncTheme();
    window.addEventListener(THEME_CHANGED_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => {
      if (getStoredThemePreference() === "system") {
        const resolved = resolveTheme("system");
        setResolvedTheme(resolved);
      }
    };
    media.addEventListener("change", onSystemThemeChange);

    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
      media.removeEventListener("change", onSystemThemeChange);
    };
  }, []);

  const isAdmin = authSession?.user.role === "ADMIN";
  const tabs = useMemo(() => {
    if (!isAuthenticated) return GUEST_TABS;
    if (isAdmin) return AUTH_TABS;
    return AUTH_TABS.filter((tab) => tab.key !== "moderation");
  }, [isAdmin, isAuthenticated]);
  const isLightTheme = resolvedTheme === "light";
  const sectionLabelClass = isLightTheme ? "text-sky-600" : "text-sky-300";
  const aboutLinkClass = isLightTheme
    ? "text-sky-700 hover:text-sky-800"
    : "text-sky-300 hover:text-sky-200";
  const defaultTab = isAuthenticated ? "profile" : "appearance";
  const tabParam = searchParams.get("tab");
  const requestedTab = isKnownSettingsTabKey(tabParam) ? tabParam : null;
  const activeTab = requestedTab && tabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : defaultTab;

  useEffect(() => {
    if (!authHydrated) return;
    if (tabParam === activeTab) return;
    router.replace(`${pathname}?tab=${activeTab}`, { scroll: false });
  }, [activeTab, authHydrated, pathname, router, tabParam]);

  const activeTabMeta = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const copy = TAB_COPY[activeTab];
  const accountAuthProvider = authSession?.user.authProvider ?? "LOCAL";
  const isGoogleAccount = accountAuthProvider === "GOOGLE";

  const appearanceOptions: Array<{
    value: ThemePreference;
    title: string;
    helper: string;
  }> = [
    {
      value: "dark",
      title: "Dark",
      helper: "Optimized for low-light viewing and matchday browsing.",
    },
    {
      value: "light",
      title: "Light",
      helper: "Brighter interface for daytime and high-contrast readability.",
    },
    {
      value: "system",
      title: "System",
      helper: "Automatically match your device theme preference.",
    },
  ];

  function handleThemeSelect(next: ThemePreference) {
    setThemePreferenceState(next);
    const resolved = setThemePreference(next);
    setResolvedTheme(resolved);
  }

  function updateAccountField<K extends AccountPasswordField>(
    key: K,
    value: AccountPasswordValues[K]
  ) {
    setAccountValues((prev) => ({ ...prev, [key]: value }));
    setAccountErrors((prev) => ({ ...prev, [key]: undefined }));
    setAccountNotice(null);
    if (accountSaveState !== "idle") setAccountSaveState("idle");
  }

  function validateAccountInput(values: AccountPasswordValues) {
    const errors: Partial<Record<AccountPasswordField, string>> = {};

    if (!values.currentPassword) {
      errors.currentPassword = "Current password is required.";
    }

    if (!values.newPassword) {
      errors.newPassword = "New password is required.";
    } else if (values.newPassword.length < 8) {
      errors.newPassword = "New password must be at least 8 characters.";
    } else if (
      !/[A-Za-z]/.test(values.newPassword) ||
      !/\d/.test(values.newPassword)
    ) {
      errors.newPassword =
        "New password must include at least one letter and one number.";
    } else if (values.newPassword === values.currentPassword) {
      errors.newPassword = "New password must be different from current password.";
    }

    if (!values.confirmPassword) {
      errors.confirmPassword = "Please confirm your new password.";
    } else if (values.confirmPassword !== values.newPassword) {
      errors.confirmPassword = "New password and confirmation do not match.";
    }

    return errors;
  }

  function updateAppealField<K extends AppealField>(
    key: K,
    value: AppealFormValues[K]
  ) {
    setAppealValues((prev) => ({ ...prev, [key]: value }));
    setAppealErrors((prev) => ({ ...prev, [key]: undefined }));
    setAppealNotice(null);
    if (appealSaveState !== "idle") setAppealSaveState("idle");
  }

  function validateAppealInput(values: AppealFormValues) {
    const errors: Partial<Record<AppealField, string>> = {};
    const normalizedReason = values.reason.trim();

    if (normalizedReason.length < 1 || normalizedReason.length > 1000) {
      errors.reason = "Appeal reason must be between 1 and 1000 characters.";
    }

    return { errors, normalizedReason };
  }

  function getModerationVerdictTone(verdict?: ModerationVerdict | null) {
    if (verdict === "LIKELY_INAPPROPRIATE") {
      return "border-rose-500/35 bg-rose-500/10 text-rose-300";
    }
    if (verdict === "REVIEW_RECOMMENDED") {
      return "border-amber-500/35 bg-amber-500/10 text-amber-300";
    }
    if (verdict === "LIKELY_APPROPRIATE") {
      return "border-emerald-500/45 bg-emerald-500/12 text-emerald-200 [html[data-theme='light']_&]:border-emerald-600/35 [html[data-theme='light']_&]:bg-emerald-500/10 [html[data-theme='light']_&]:text-emerald-700";
    }
    return "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]";
  }

  const loadReportsQueue = useCallback(async (session: StoredAuthSession) => {
    setReportsLoading(true);
    setReportsNotice(null);

    try {
      const params = new URLSearchParams({
        status: reportsStatus,
        sortBy: reportsSortBy,
        sortOrder: reportsSortOrder,
        limit: "20",
      });

      if (reportsTargetType) {
        if (reportsTargetType === "POLL") {
          params.set("targetType", "THREAD");
          params.set("threadReportType", "POLL");
        } else if (reportsTargetType === "THREAD") {
          params.set("targetType", "THREAD");
          params.set("threadReportType", "THREAD");
        } else {
          params.set("targetType", reportsTargetType);
        }
      }

      if (reportsAiVerdict) {
        params.set("aiVerdict", reportsAiVerdict);
      }

      const response = await fetch(`/api/admin/reports?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        reports?: AdminReport[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to load reports queue."));
      }

      setReportsQueue(Array.isArray(payload.reports) ? payload.reports : []);
    } catch (error) {
      setReportsNotice(
        error instanceof Error ? error.message : "Failed to load reports queue."
      );
      setReportsQueue([]);
    } finally {
      setReportsLoading(false);
    }
  }, [reportsAiVerdict, reportsSortBy, reportsSortOrder, reportsStatus, reportsTargetType]);

  const loadAppealsQueue = useCallback(async (session: StoredAuthSession) => {
    setAppealsLoading(true);
    setAppealsNotice(null);

    try {
      const params = new URLSearchParams({
        status: appealsStatus,
        limit: "20",
      });

      const response = await fetch(`/api/admin/appeals?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        appeals?: AdminAppeal[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to load appeals queue."));
      }

      setAppealsQueue(Array.isArray(payload.appeals) ? payload.appeals : []);
    } catch (error) {
      setAppealsNotice(
        error instanceof Error ? error.message : "Failed to load appeals queue."
      );
      setAppealsQueue([]);
    } finally {
      setAppealsLoading(false);
    }
  }, [appealsStatus]);

  const loadPendingAppeal = useCallback(async (session: StoredAuthSession) => {
    setPendingAppealLoading(true);

    try {
      const response = await fetch("/api/appeals", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        appeal?: PendingAppeal | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to load appeal status."));
      }

      setPendingAppeal(payload.appeal ?? null);
    } catch (error) {
      setPendingAppeal(null);
      setAppealNotice(
        error instanceof Error ? error.message : "Failed to load appeal status."
      );
      setAppealSaveState("error");
    } finally {
      setPendingAppealLoading(false);
    }
  }, []);

  const visibleReportsQueue = useMemo(() => {
    if (reportsTargetType === "POLL") {
      return reportsQueue.filter((report) => isPollReport(report));
    }

    if (reportsTargetType === "THREAD") {
      return reportsQueue.filter(
        (report) => report.targetType === "THREAD" && !isPollReport(report)
      );
    }

    if (reportsTargetType) {
      return reportsQueue.filter((report) => report.targetType === reportsTargetType);
    }

    return reportsQueue;
  }, [reportsQueue, reportsTargetType]);

  async function runReportAction(
    reportId: number,
    action: "approve" | "dismiss",
    options?: { suspensionDays?: number; dismissRelated?: boolean }
  ) {
    if (!authSession) return;

    const actionKey = `${action}:${reportId}`;
    setReportsActionKey(actionKey);
    setReportsNotice(null);

    try {
      const response = await fetch(`/api/admin/reports/${reportId}/${action}`, {
        method: "POST",
        headers: {
          ...(options ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        ...(options ? { body: JSON.stringify(options) } : {}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        actionTaken?: string;
      };

      if (!response.ok) {
        throw new Error(parseApiError(payload, `Failed to ${action} report.`));
      }

      setReportsNotice(
        payload.actionTaken ||
          (action === "approve" ? "Report approved." : "Report rejected.")
      );
      await loadReportsQueue(authSession);
    } catch (error) {
      setReportsNotice(
        error instanceof Error ? error.message : `Failed to ${action} report.`
      );
    } finally {
      setReportsActionKey(null);
    }
  }

  async function runUserModerationAction(
    report: AdminReport,
    action: "suspend" | "ban" | "unban",
    options?: { reason?: string; suspensionDays?: number }
  ) {
    if (!authSession || report.targetType !== "USER" || !report.reportedUser?.id) return;

    const actionKey = `moderate:${action}:${report.id}`;
    setReportsActionKey(actionKey);
    setReportsNotice(null);
    rememberScrollPosition(reportsScrollRestoreYRef);

    try {
      let response: Response;

      if (action === "unban") {
        response = await fetch(`/api/users/${report.reportedUser.id}/unban`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authSession.accessToken}`,
          },
        });
      } else {
        const reason = options?.reason?.trim();
        if (!reason) {
          throw new Error("Reason is required to suspend or ban this account.");
        }

        const body =
          action === "suspend"
            ? {
                reason,
                suspendedUntil: new Date(
                  Date.now() + (options?.suspensionDays ?? 0) * 24 * 60 * 60 * 1000
                ).toISOString(),
              }
            : { reason };

        response = await fetch(`/api/users/${report.reportedUser.id}/ban`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession.accessToken}`,
          },
          body: JSON.stringify(body),
        });
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        actionTaken?: string;
      };

      if (!response.ok) {
        throw new Error(
          parseApiError(
            payload,
            action === "unban"
              ? "Failed to lift restriction."
              : action === "suspend"
                ? "Failed to suspend account."
                : "Failed to ban account."
          )
        );
      }

      setReportsNotice(
        payload.actionTaken ||
          (action === "unban"
            ? "Account restriction lifted."
            : action === "suspend"
              ? "Account suspended."
              : "Account banned.")
      );
      await loadReportsQueue(authSession);
    } catch (error) {
      setReportsNotice(
        error instanceof Error
          ? error.message
          : action === "unban"
            ? "Failed to lift restriction."
            : action === "suspend"
              ? "Failed to suspend account."
              : "Failed to ban account."
      );
    } finally {
      setReportsActionKey(null);
    }
  }

  async function runAppealAction(appealId: number, action: "approve" | "reject") {
    if (!authSession) return;

    const actionKey = `${action}:${appealId}`;
    setAppealsActionKey(actionKey);
    setAppealsNotice(null);

    try {
      const response = await fetch(`/api/appeals/${appealId}/${action}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(parseApiError(payload, `Failed to ${action} appeal.`));
      }

      setAppealsNotice(
        action === "approve"
          ? "Appeal approved and restrictions lifted."
          : "Appeal rejected."
      );
      await loadAppealsQueue(authSession);
    } catch (error) {
      setAppealsNotice(
        error instanceof Error ? error.message : `Failed to ${action} appeal.`
      );
    } finally {
      setAppealsActionKey(null);
    }
  }

  async function handlePasswordSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSession) return;

    const errors = validateAccountInput(accountValues);
    setAccountErrors(errors);

    if (Object.keys(errors).length > 0) {
      setAccountSaveState("error");
      setAccountNotice("Please fix the highlighted fields before saving.");
      return;
    }

    setAccountSaveState("saving");
    setAccountNotice(null);

    try {
      const response = await fetch(`/api/users/${authSession.user.id}/password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        body: JSON.stringify(accountValues),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        const message = parseApiError(payload, "Failed to update password.");

        if (message.toLowerCase().includes("current password")) {
          setAccountErrors((prev) => ({ ...prev, currentPassword: message }));
        } else if (message.toLowerCase().includes("confirmation")) {
          setAccountErrors((prev) => ({ ...prev, confirmPassword: message }));
        } else if (message.toLowerCase().includes("new password")) {
          setAccountErrors((prev) => ({ ...prev, newPassword: message }));
        }

        throw new Error(message);
      }

      setAccountValues({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setAccountSaveState("success");
      setAccountNotice(payload.message ?? "Password updated successfully.");
    } catch (error) {
      setAccountSaveState("error");
      setAccountNotice(
        error instanceof Error ? error.message : "Failed to update password."
      );
    }
  }

  async function handleAppealSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSession) return;

    const { errors, normalizedReason } = validateAppealInput(appealValues);
    setAppealErrors(errors);

    if (Object.keys(errors).length > 0) {
      setAppealSaveState("error");
      setAppealNotice("Please explain why your restriction should be lifted.");
      return;
    }

    setAppealSaveState("saving");
    setAppealNotice(null);

    try {
      const response = await fetch("/api/appeals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        body: JSON.stringify({ reason: normalizedReason }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409) {
          await loadPendingAppeal(authSession);
        }
        throw new Error(parseApiError(payload, "Failed to submit appeal."));
      }

      setAppealSaveState("success");
      setAppealNotice("Appeal submitted. An admin will review it.");
      setAppealValues({ reason: "" });
      await loadPendingAppeal(authSession);
    } catch (error) {
      setAppealSaveState("error");
      setAppealNotice(
        error instanceof Error ? error.message : "Failed to submit appeal."
      );
    }
  }

  useEffect(() => {
    if (!isAuthenticated || activeTab !== "profile") return;

    let cancelled = false;
    async function loadTeams() {
      setTeamsLoading(true);
      setTeamsError(null);
      try {
        const response = await fetch("/api/teams", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          data?: Array<{ id?: number; name?: string }>;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(parseApiError(payload, "Failed to load teams."));
        }

        const options = Array.isArray(payload.data)
          ? payload.data
              .filter(
                (team): team is { id: number; name: string } =>
                  typeof team?.id === "number" && typeof team?.name === "string"
              )
              .map((team) => ({ id: team.id, name: team.name }))
          : [];

        if (!cancelled) setTeamOptions(options);
      } catch (error) {
        if (!cancelled) {
          setTeamsError(
            error instanceof Error
              ? error.message
              : "Failed to load teams."
          );
        }
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    }

    loadTeams();
    return () => {
      cancelled = true;
    };
  }, [activeTab, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeTab !== "profile" || !authSession) return;
    const session = authSession;

    let cancelled = false;

    const fallbackValues = toProfileFormValues(session.user);
    setProfileValues(fallbackValues);
    setInitialProfileValues(fallbackValues);
    setProfileErrors({});
    setProfileNotice(null);
    setProfileSaveState("idle");
    setAvatarUploadState("idle");
    setAvatarUploadNotice(null);

    async function loadProfile() {
      setProfileLoading(true);
      try {
        const response = await fetch(`/api/users/${session.user.id}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const payload = (await response.json().catch(() => ({}))) as {
          username?: string;
          avatar?: string;
          favoriteTeamId?: number | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            parseApiError(payload, "Failed to load profile details.")
          );
        }

        const nextValues = toProfileFormValues(payload);

        if (!cancelled) {
          setProfileValues(nextValues);
          setInitialProfileValues(nextValues);
        }
      } catch (error) {
        if (!cancelled) {
          setProfileNotice(
            error instanceof Error
              ? error.message
              : "Failed to load profile details."
          );
          setProfileSaveState("error");
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [activeTab, authSession, isAuthenticated]);

  useEffect(() => {
    if (activeTab !== "account") return;
    setAccountErrors({});
    setAccountNotice(null);
    setAccountSaveState("idle");
    setAppealErrors({});
    setAppealNotice(null);
    setAppealSaveState("idle");
  }, [activeTab]);

  useEffect(() => {
    if (
      !authSession ||
      activeTab !== "account" ||
      authSession.user.status === "ACTIVE"
    ) {
      setPendingAppeal(null);
      setPendingAppealLoading(false);
      return;
    }

    void loadPendingAppeal(authSession);
  }, [activeTab, authSession, loadPendingAppeal]);

  useEffect(() => {
    if (!authSession || !isAdmin || activeTab !== "moderation") return;
    void loadReportsQueue(authSession);
  }, [activeTab, authSession, isAdmin, loadReportsQueue]);

  useEffect(() => {
    if (!authSession || !isAdmin || activeTab !== "moderation") return;
    void loadAppealsQueue(authSession);
  }, [activeTab, authSession, isAdmin, loadAppealsQueue]);

  function updateProfileField<K extends ProfileField>(
    key: K,
    value: ProfileFormValues[K]
  ) {
    setProfileValues((prev) => ({ ...prev, [key]: value }));
    setProfileErrors((prev) => ({ ...prev, [key]: undefined }));
    setProfileNotice(null);
    if (profileSaveState !== "idle") setProfileSaveState("idle");
    if (key === "avatar" && avatarUploadState !== "idle") {
      setAvatarUploadState("idle");
      setAvatarUploadNotice(null);
    }
  }

  function validateProfileInput(values: ProfileFormValues) {
    const errors: Partial<Record<ProfileField, string>> = {};
    const normalizedUsername = values.username.trim();
    const normalizedAvatar = values.avatar.trim();

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
      errors.username = "Username must be between 3 and 30 characters.";
    } else if (!/^[A-Za-z0-9_]+$/.test(normalizedUsername)) {
      errors.username =
        "Username can only contain letters, numbers, and underscores.";
    }

    if (normalizedAvatar === "") {
      errors.avatar = "Please select or upload an avatar.";
    }

    let normalizedFavoriteTeamId: number | null = null;
    if (values.favoriteTeamId !== "") {
      const parsed = Number(values.favoriteTeamId);
      if (!Number.isFinite(parsed)) {
        errors.favoriteTeamId = "Favorite team must be a valid selection.";
      } else {
        normalizedFavoriteTeamId = parsed;
      }
    }

    return { errors, normalizedUsername, normalizedAvatar, normalizedFavoriteTeamId };
  }

  function handleDefaultAvatarSelect(avatarPath: string) {
    updateProfileField("avatar", avatarPath);
    setAvatarUploadState("success");
    setAvatarUploadNotice("Default avatar selected. Click Save Changes to apply.");
  }

  async function handleAvatarUpload(file: File | null) {
    if (!file || !authSession) return;

    if (!file.type.startsWith("image/")) {
      setAvatarUploadState("error");
      setAvatarUploadNotice("Please choose an image file.");
      return;
    }

    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setAvatarUploadState("error");
      setAvatarUploadNotice("Image must be 2MB or smaller.");
      return;
    }

    setAvatarUploadState("uploading");
    setAvatarUploadNotice("Uploading avatar...");

    try {
      const formData = new FormData();
      formData.set("avatar", file);

      const response = await fetch(`/api/users/${authSession.user.id}/avatar-upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        avatar?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to upload avatar."));
      }

      if (typeof payload.avatar !== "string") {
        throw new Error("Upload succeeded, but avatar URL was not returned.");
      }

      updateProfileField("avatar", payload.avatar);
      setAvatarUploadState("success");
      setAvatarUploadNotice("Avatar uploaded. Click Save Changes to apply.");
    } catch (error) {
      setAvatarUploadState("error");
      setAvatarUploadNotice(
        error instanceof Error ? error.message : "Failed to upload avatar."
      );
    }
  }

  const profileDirty =
    profileValues.username !== initialProfileValues.username ||
    profileValues.avatar !== initialProfileValues.avatar ||
    profileValues.favoriteTeamId !== initialProfileValues.favoriteTeamId;
  const avatarPreviewSrc = profileValues.avatar.trim() || "/avatars/default1.png";
  const hasUnsavedProfileChanges =
    isAuthenticated &&
    activeTab === "profile" &&
    profileDirty &&
    profileSaveState !== "saving";

  useEffect(() => {
    if (!hasUnsavedProfileChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedProfileChanges]);

  useEffect(() => {
    if (!hasUnsavedProfileChanges) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      if (!target) return;

      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) {
        return;
      }

      const nextUrl = new URL(rawHref, window.location.href);
      const currentUrl = new URL(window.location.href);

      if (nextUrl.href === currentUrl.href) return;

      const shouldLeave = window.confirm(UNSAVED_PROFILE_CHANGES_MESSAGE);
      if (!shouldLeave) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedProfileChanges]);

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSession) return;

    const { errors, normalizedUsername, normalizedAvatar, normalizedFavoriteTeamId } =
      validateProfileInput(profileValues);

    setProfileErrors(errors);
    if (Object.keys(errors).length > 0) {
      setProfileSaveState("error");
      setProfileNotice("Please fix the highlighted fields before saving.");
      return;
    }

    const payload: Record<string, unknown> = {};

    const initialUsername = initialProfileValues.username.trim();
    if (normalizedUsername !== initialUsername) {
      payload.username = normalizedUsername;
    }

    const initialAvatar = initialProfileValues.avatar.trim();
    if (normalizedAvatar !== "" && normalizedAvatar !== initialAvatar) {
      payload.avatar = normalizedAvatar;
    }

    const initialFavorite =
      initialProfileValues.favoriteTeamId === ""
        ? null
        : Number(initialProfileValues.favoriteTeamId);
    if (normalizedFavoriteTeamId !== initialFavorite) {
      payload.favoriteTeamId = normalizedFavoriteTeamId;
    }

    if (Object.keys(payload).length === 0) {
      setProfileSaveState("success");
      setProfileNotice("No changes to save.");
      return;
    }

    setProfileSaveState("saving");
    setProfileNotice(null);

    try {
      const response = await fetch(`/api/users/${authSession.user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as {
        id?: number;
        username?: string;
        avatar?: string;
        favoriteTeamId?: number | null;
        error?: string;
      };

      if (!response.ok) {
        const message = parseApiError(result, "Failed to save profile changes.");
        const lowered = message.toLowerCase();
        const mappedErrors: Partial<Record<ProfileField, string>> = {};

        if (lowered.includes("username")) {
          mappedErrors.username = message;
        }
        if (lowered.includes("favorite team")) {
          mappedErrors.favoriteTeamId = message;
        }
        if (lowered.includes("avatar")) {
          mappedErrors.avatar = message;
        }

        if (Object.keys(mappedErrors).length > 0) {
          setProfileErrors((prev) => ({ ...prev, ...mappedErrors }));
        }

        throw new Error(message);
      }

      const nextValues = toProfileFormValues(result);
      setProfileValues(nextValues);
      setInitialProfileValues(nextValues);
      patchStoredAuthUser({
        ...(typeof result.username === "string" && { username: result.username }),
        ...(typeof result.avatar === "string" && { avatar: result.avatar }),
        ...(result.favoriteTeamId === null ||
        typeof result.favoriteTeamId === "number"
          ? { favoriteTeamId: result.favoriteTeamId }
          : {}),
      });

      setProfileSaveState("success");
      setProfileNotice("Profile updated successfully.");
      setAvatarUploadState("idle");
      setAvatarUploadNotice(null);
    } catch (error) {
      setProfileSaveState("error");
      setProfileNotice(
        error instanceof Error
          ? error.message
          : "Failed to save profile changes."
      );
    }
  }

  if (!authHydrated) {
    return (
      <section className="space-y-6" aria-busy="true">
        <header className="space-y-2">
          <p className={`text-xs font-semibold uppercase tracking-[0.11em] ${sectionLabelClass}`}>
            Preferences
          </p>
          <h1 className="text-3xl font-bold text-[color:var(--foreground)]">Settings</h1>
          <p className="max-w-3xl text-sm text-[color:var(--muted-foreground)]">
            Loading your settings...
          </p>
        </header>

        <div
          role="status"
          className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-6 text-sm text-[color:var(--muted-foreground)]"
        >
          Preparing account and preference controls.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className={`text-xs font-semibold uppercase tracking-[0.11em] ${sectionLabelClass}`}>
          Preferences
        </p>
        <h1 className="text-3xl font-bold text-[color:var(--foreground)]">Settings</h1>
        <p className="max-w-3xl text-sm text-[color:var(--muted-foreground)]">
          Configure account and app preferences with tab-based navigation.
        </p>
      </header>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="self-start rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-3 shadow-[0_8px_22px_rgba(2,8,23,0.08)] lg:sticky lg:top-24">
          <nav
            aria-label="Settings tabs"
            className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-1"
          >
            {tabs.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <Link
                  key={tab.key}
                  href={`${pathname}?tab=${tab.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`min-w-0 rounded-xl border px-3 py-2.5 transition ${INTERACTIVE_FOCUS_RING} ${
                    active
                      ? "border-sky-500/35 bg-sky-500/15 text-[color:var(--foreground)]"
                      : "border-transparent bg-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--surface-border)] hover:bg-[color:var(--surface-elevated)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold">
                    <TabIcon keyName={tab.key} />
                    {tab.label}
                  </span>
                  <p className="mt-1 hidden text-xs text-[color:var(--muted-foreground)] lg:block">
                    {tab.description}
                  </p>
                </Link>
              );
            })}
          </nav>
        </aside>

        <article className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 shadow-[0_10px_26px_rgba(2,8,23,0.08)] sm:p-6 md:p-7">
          <div className="space-y-2 border-b border-[color:var(--surface-border)] pb-5">
            <p className={`text-xs font-semibold uppercase tracking-[0.1em] ${sectionLabelClass}`}>
              {activeTabMeta.label}
            </p>
            <h2 className="text-2xl font-bold text-[color:var(--foreground)]">{copy.title}</h2>
            <p className="max-w-3xl text-sm text-[color:var(--muted-foreground)]">{copy.intro}</p>
          </div>

          {activeTab === "profile" ? (
            <div className="mt-5 space-y-5">
              {!isAuthenticated || !authSession ? (
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                  Sign in to edit your profile settings.
                </div>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={handleProfileSave}
                  aria-busy={profileLoading || profileSaveState === "saving"}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="text-sm font-semibold text-[color:var(--foreground)]" htmlFor="profile-email">
                        Email
                      </label>
                      <input
                        id="profile-email"
                        type="email"
                        value={authSession.user.email}
                        readOnly
                        className="mt-1.5 w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2.5 text-sm text-[color:var(--muted-foreground)]"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-semibold text-[color:var(--foreground)]" htmlFor="profile-username">
                        Username
                      </label>
                      <input
                        id="profile-username"
                        type="text"
                        value={profileValues.username}
                        onChange={(event) =>
                          updateProfileField("username", event.target.value)
                        }
                        aria-invalid={Boolean(profileErrors.username)}
                        aria-describedby={
                          profileErrors.username ? "settings-profile-username-error" : undefined
                        }
                        className={`mt-1.5 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:ring-2 ${
                          profileErrors.username
                            ? "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20"
                            : "border-[color:var(--surface-border)] focus:border-sky-400/70 focus:ring-sky-500/20"
                        }`}
                        autoComplete="username"
                        disabled={profileLoading || profileSaveState === "saving"}
                      />
                      {profileErrors.username && (
                        <p
                          id="settings-profile-username-error"
                          className="mt-1 text-xs text-rose-300"
                          role="alert"
                        >
                          {profileErrors.username}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="text-sm font-semibold text-[color:var(--foreground)]" htmlFor="profile-favorite-team">
                        Favorite Team
                      </label>
                      <select
                        id="profile-favorite-team"
                        value={profileValues.favoriteTeamId}
                        onChange={(event) =>
                          updateProfileField("favoriteTeamId", event.target.value)
                        }
                        aria-invalid={Boolean(profileErrors.favoriteTeamId)}
                        aria-describedby={
                          profileErrors.favoriteTeamId
                            ? "settings-profile-favorite-team-error"
                            : undefined
                        }
                        className={`mt-1.5 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:ring-2 ${
                          profileErrors.favoriteTeamId
                            ? "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20"
                            : "border-[color:var(--surface-border)] focus:border-sky-400/70 focus:ring-sky-500/20"
                        }`}
                        disabled={
                          profileLoading ||
                          profileSaveState === "saving" ||
                          teamsLoading
                        }
                      >
                        <option value="">No favorite team</option>
                        {teamsLoading ? (
                          <option disabled value="">
                            Loading teams...
                          </option>
                        ) : teamOptions.length === 0 ? (
                          <option disabled value="">
                            No teams available right now
                          </option>
                        ) : (
                          teamOptions.map((team) => (
                            <option key={team.id} value={String(team.id)}>
                              {team.name}
                            </option>
                          ))
                        )}
                      </select>
                      {teamsError && (
                        <p
                          role="alert"
                          className="mt-1 text-xs text-[color:var(--muted-foreground)]"
                        >
                          {teamsError}
                        </p>
                      )}
                      {!teamsLoading && !teamsError && teamOptions.length === 0 && (
                        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          Sync teams first to enable favorite-team selection.
                        </p>
                      )}
                      {profileErrors.favoriteTeamId && (
                        <p
                          id="settings-profile-favorite-team-error"
                          className="mt-1 text-xs text-rose-300"
                          role="alert"
                        >
                          {profileErrors.favoriteTeamId}
                        </p>
                      )}
                    </div>

                    <div className="sm:col-span-2 space-y-3">
                      <label className="text-sm font-semibold text-[color:var(--foreground)]">
                        Avatar
                      </label>

                      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-3 sm:p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <img
                            src={avatarPreviewSrc}
                            alt="Avatar preview"
                            className="h-20 w-20 rounded-2xl border border-[color:var(--surface-border)] object-cover shadow-sm"
                          />

                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                              {DEFAULT_AVATARS.map((avatarPath) => {
                                const selected =
                                  profileValues.avatar.trim() === avatarPath;
                                return (
                                  <button
                                    key={avatarPath}
                                    type="button"
                                    onClick={() => handleDefaultAvatarSelect(avatarPath)}
                                    aria-label={`Select avatar ${avatarPath.split("/").pop()}`}
                                    aria-pressed={selected}
                                    disabled={
                                      profileLoading || profileSaveState === "saving"
                                    }
                                    className={`aspect-square w-full overflow-hidden rounded-xl border transition ${INTERACTIVE_FOCUS_RING} ${
                                      selected
                                        ? "border-sky-500/80 ring-2 ring-sky-500/35"
                                        : "border-[color:var(--surface-border)] hover:border-sky-400/55"
                                    } disabled:cursor-not-allowed disabled:opacity-60`}
                                  >
                                    <img
                                      src={avatarPath}
                                      alt="Default avatar option"
                                      className="h-full w-full object-cover"
                                    />
                                  </button>
                                );
                              })}
                            </div>

                            <div>
                              <label
                                htmlFor="profile-avatar-upload"
                                className={`inline-flex cursor-pointer items-center rounded-lg border px-3 py-2 text-xs font-semibold transition ${INTERACTIVE_FOCUS_RING} ${
                                  avatarUploadState === "uploading"
                                    ? "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                                    : isLightTheme
                                    ? "border-sky-600 bg-sky-600 text-white hover:bg-sky-700 hover:border-sky-700"
                                    : "border-sky-500/45 bg-sky-500/15 text-sky-200 hover:bg-sky-500/20"
                                }`}
                              >
                                {avatarUploadState === "uploading"
                                  ? "Uploading..."
                                  : "Upload Image (Max 2MB)"}
                              </label>
                              <input
                                id="profile-avatar-upload"
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="sr-only"
                                onChange={(event) => {
                                  const file = event.target.files?.[0] ?? null;
                                  void handleAvatarUpload(file);
                                  event.currentTarget.value = "";
                                }}
                                disabled={
                                  profileLoading ||
                                  profileSaveState === "saving" ||
                                  avatarUploadState === "uploading"
                                }
                              />
                              {avatarUploadNotice && (
                                <p
                                  role={avatarUploadState === "error" ? "alert" : "status"}
                                  aria-live={avatarUploadState === "error" ? "assertive" : "polite"}
                                  className={`mt-1 text-xs ${
                                    avatarUploadState === "error"
                                      ? "text-rose-300"
                                      : avatarUploadState === "success"
                                      ? "text-sky-300 [html[data-theme='light']_&]:text-sky-700"
                                      : "text-[color:var(--muted-foreground)]"
                                  }`}
                                >
                                  {avatarUploadNotice}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-[color:var(--muted-foreground)]">
                        Pick a default avatar or upload your own image.
                      </p>
                      {profileErrors.avatar && (
                        <p className="mt-1 text-xs text-rose-300" role="alert">
                          {profileErrors.avatar}
                        </p>
                      )}
                    </div>
                  </div>

                  {profileNotice && (
                    <p
                      role={profileSaveState === "error" ? "alert" : "status"}
                      aria-live={profileSaveState === "error" ? "assertive" : "polite"}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        profileSaveState === "error"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                          : profileSaveState === "success"
                          ? "border-sky-500/45 bg-sky-500/10 text-sky-200 [html[data-theme='light']_&]:border-sky-600/30 [html[data-theme='light']_&]:bg-sky-500/10 [html[data-theme='light']_&]:text-sky-700"
                          : "border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--muted-foreground)]"
                      }`}
                    >
                      {profileNotice}
                    </p>
                  )}

                  <div className="flex flex-col gap-3 border-t border-[color:var(--surface-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-[color:var(--muted-foreground)] sm:pr-3">
                      {profileLoading
                        ? "Refreshing profile details..."
                        : "Profile updates apply to your account immediately."}
                    </p>
                    <button
                      type="submit"
                      disabled={
                        profileLoading ||
                        profileSaveState === "saving" ||
                        !profileDirty
                      }
                      className={`btn-primary h-10 w-full rounded-lg px-4 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${INTERACTIVE_FOCUS_RING}`}
                    >
                      {profileSaveState === "saving" ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : activeTab === "appearance" ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {appearanceOptions.map((option) => {
                  const selected = themePreference === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleThemeSelect(option.value)}
                      aria-pressed={selected}
                      className={`rounded-xl border px-4 py-4 text-left transition ${INTERACTIVE_FOCUS_RING} ${
                        selected
                          ? "border-sky-500/45 bg-sky-500/12 text-[color:var(--foreground)]"
                          : "border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-[color:var(--foreground)] hover:border-sky-400/35"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <ThemeOptionIcon option={option.value} />
                        {option.title}
                      </span>
                      <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">{option.helper}</p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                Active mode:{" "}
                <span className="font-semibold capitalize text-[color:var(--foreground)]">
                  {resolvedTheme}
                </span>{" "}
                {themePreference === "system" && (
                  <span className="text-[color:var(--muted-foreground)]">(from system preference)</span>
                )}
              </div>
            </div>
          ) : activeTab === "about" ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-4">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                  What You Can Do on SportsDeck
                </h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[color:var(--muted-foreground)]">
                  {ABOUT_FEATURES.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-4">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                  Community Safety
                </h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[color:var(--muted-foreground)]">
                  {ABOUT_SAFETY.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-4">
                <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                  Data Sources and Credits
                </h3>
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  SportsDeck relies on trusted third-party providers for match data and AI-assisted features.
                </p>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[color:var(--muted-foreground)]">
                  {ABOUT_LINKS.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className={`underline-offset-2 hover:underline ${aboutLinkClass} ${INTERACTIVE_FOCUS_RING}`}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : activeTab === "moderation" ? (
            <div className="mt-5 space-y-5">
              {!isAuthenticated || !authSession || !isAdmin ? (
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                  Admin access is required to review moderation queues.
                </div>
              ) : (
                <>
                  <section className="space-y-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                        Reports Queue
                      </h3>
                      <p className="text-sm text-[color:var(--muted-foreground)]">
                        Review pending content reports, inspect AI verdicts, and hide content when a report is approved.
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <label className="space-y-1 text-sm">
                        <span className="font-semibold text-[color:var(--foreground)]">Status</span>
                        <select
                          value={reportsStatus}
                          onChange={(event) => {
                            rememberScrollPosition(reportsScrollRestoreYRef);
                            setReportsStatus(
                              event.target.value as "PENDING" | "APPROVED" | "DISMISSED"
                            );
                          }}
                          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)]"
                        >
                          <option value="PENDING">Pending</option>
                          <option value="APPROVED">Approved</option>
                          <option value="DISMISSED">Dismissed</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="font-semibold text-[color:var(--foreground)]">Report Type</span>
                        <select
                          value={reportsTargetType}
                          onChange={(event) => {
                            rememberScrollPosition(reportsScrollRestoreYRef);
                            setReportsTargetType(event.target.value as ReportFilterTarget);
                          }}
                          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)]"
                        >
                          <option value="">All report types</option>
                          <option value="POST">Post reports</option>
                          <option value="THREAD">Thread reports</option>
                          <option value="POLL">Poll reports</option>
                          <option value="USER">User reports</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="font-semibold text-[color:var(--foreground)]">AI Verdict</span>
                        <select
                          value={reportsAiVerdict}
                          onChange={(event) => {
                            rememberScrollPosition(reportsScrollRestoreYRef);
                            setReportsAiVerdict(event.target.value as "" | ModerationVerdict);
                          }}
                          disabled={reportsTargetType === "USER"}
                          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)]"
                        >
                          <option value="">All verdicts</option>
                          <option value="LIKELY_INAPPROPRIATE">Likely inappropriate</option>
                          <option value="REVIEW_RECOMMENDED">Review recommended</option>
                          <option value="LIKELY_APPROPRIATE">Likely appropriate</option>
                          <option value="UNAVAILABLE">Unavailable</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="font-semibold text-[color:var(--foreground)]">Sort By</span>
                        <select
                          value={reportsSortBy}
                          onChange={(event) => {
                            rememberScrollPosition(reportsScrollRestoreYRef);
                            setReportsSortBy(
                              event.target.value as "aiVerdict" | "reportCount" | "createdAt"
                            );
                          }}
                          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)]"
                        >
                          <option value="aiVerdict">AI verdict</option>
                          <option value="reportCount">Report count</option>
                          <option value="createdAt">Created at</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="font-semibold text-[color:var(--foreground)]">Order</span>
                        <select
                          value={reportsSortOrder}
                          onChange={(event) => {
                            rememberScrollPosition(reportsScrollRestoreYRef);
                            setReportsSortOrder(event.target.value as "asc" | "desc");
                          }}
                          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)]"
                        >
                          <option value="desc">Descending</option>
                          <option value="asc">Ascending</option>
                        </select>
                      </label>
                    </div>

                    {reportsNotice && (
                      <div
                        role={reportsNotice.toLowerCase().includes("failed") ? "alert" : "status"}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          reportsNotice.toLowerCase().includes("failed")
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        }`}
                      >
                        {reportsNotice}
                      </div>
                    )}

                    {reportsLoading ? (
                      <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                        Loading reports queue...
                      </div>
                    ) : visibleReportsQueue.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
                        No reports match the current filters.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {visibleReportsQueue.map((report) => {
                          const pollReport = isPollReport(report);
                          const reportSuspensionDays =
                            reportSuspensionDaysById[report.id] ??
                            String(DEFAULT_USER_REPORT_SUSPENSION_DAYS);
                          const parsedReportSuspensionDays = Number.parseInt(
                            reportSuspensionDays,
                            10
                          );
                          const reportSuspensionDaysValid =
                            Number.isInteger(parsedReportSuspensionDays) &&
                            parsedReportSuspensionDays >= 1 &&
                            parsedReportSuspensionDays <= MAX_USER_REPORT_SUSPENSION_DAYS;
                          const moderationReason =
                            reportModerationReasonById[report.id] ?? report.reason;
                          const moderationReasonValid =
                            moderationReason.trim().length >= 1 &&
                            moderationReason.trim().length <= 500;
                          const canChooseUserSuspension =
                            report.targetType === "USER" &&
                            report.reportedUser?.status !== "BANNED";
                          const canModerateUserFromQueue =
                            report.targetType === "USER" && Boolean(report.reportedUser?.id);
                          const targetLabel =
                            report.targetType === "USER"
                              ? "User report"
                              : report.post
                                ? "Post report"
                                : pollReport
                                  ? "Poll report"
                                : "Thread report";
                          const targetPreview =
                            report.post?.content ||
                            report.thread?.poll?.question ||
                            report.thread?.title ||
                            report.reportedUser?.username ||
                            report.reason;
                          const threadHref = report.associatedThreadId
                            ? `/threads/${report.associatedThreadId}`
                            : null;
                          const userProfileHref =
                            report.targetType === "USER" && report.reportedUser?.id
                              ? `/users/${report.reportedUser.id}`
                              : null;
                          const targetAuthor =
                            report.targetType === "USER"
                              ? report.reportedUser?.username ?? "Unknown"
                              : report.post?.author?.username ?? report.thread?.author?.username ?? "Unknown";
                          const reportCountLabel =
                            report.targetType === "USER"
                              ? `${report.reportCount} report${report.reportCount === 1 ? "" : "s"} on this account`
                              : report.post
                                ? `${report.reportCount} report${report.reportCount === 1 ? "" : "s"} on this post`
                                : pollReport
                                  ? `${report.reportCount} report${report.reportCount === 1 ? "" : "s"} on this poll`
                                : `${report.reportCount} report${report.reportCount === 1 ? "" : "s"} on this thread`;
                          const dismissRelatedLabel =
                            report.targetType === "USER"
                              ? `Dismiss all ${report.reportCount} user report${
                                  report.reportCount === 1 ? "" : "s"
                                }`
                              : report.post
                                ? `Dismiss all ${report.reportCount} post report${
                                    report.reportCount === 1 ? "" : "s"
                                  }`
                                : pollReport
                                  ? `Dismiss all ${report.reportCount} poll report${
                                      report.reportCount === 1 ? "" : "s"
                                    }`
                                  : `Dismiss all ${report.reportCount} thread report${
                                      report.reportCount === 1 ? "" : "s"
                                    }`;

                          return (
                            <div
                              key={report.id}
                              className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                      {targetLabel}
                                    </span>
                                    {report.aiVerdict?.verdict && (
                                      <span
                                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${getModerationVerdictTone(
                                          report.aiVerdict?.verdict
                                        )}`}
                                      >
                                        {report.aiVerdict.verdict.replaceAll("_", " ")}
                                      </span>
                                    )}
                                    <span className="text-xs text-[color:var(--muted-foreground)]">
                                      {reportCountLabel}
                                    </span>
                                  </div>

                                  <div className="space-y-1">
                                    <p className="text-sm font-semibold text-[color:var(--foreground)]">
                                      Report #{report.id}
                                    </p>
                                    <p className="text-sm text-[color:var(--muted-foreground)]">
                                      Reported by {report.reporter?.username ?? "Unknown user"} on{" "}
                                      {new Date(report.createdAt).toLocaleString()}
                                    </p>
                                  </div>

                                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                      Report reason
                                    </p>
                                    <p className="mt-1 text-sm text-[color:var(--foreground)]">
                                      {report.reason}
                                    </p>
                                  </div>

                                  {report.aiVerdict ? (
                                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-3">
                                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                        AI review
                                      </p>
                                      <p className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                                        {report.aiVerdict.verdict.replaceAll("_", " ")}
                                      </p>
                                      {report.aiVerdict.explanation ? (
                                        <p className="mt-2 text-sm text-[color:var(--foreground)]">
                                          {report.aiVerdict.explanation}
                                        </p>
                                      ) : null}
                                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
                                        {typeof report.aiVerdict.toxicityScore === "number" ? (
                                          <span>Toxicity score: {report.aiVerdict.toxicityScore}</span>
                                        ) : null}
                                        {typeof report.aiVerdict.threshold === "number" ? (
                                          <span>Threshold: {report.aiVerdict.threshold}</span>
                                        ) : null}
                                        {report.aiVerdict.model ? (
                                          <span>Model: {report.aiVerdict.model}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                      Target preview
                                    </p>
                                    <p className="mt-1 line-clamp-3 text-sm text-[color:var(--foreground)]">
                                      {targetPreview}
                                    </p>
                                    <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                                      {report.targetType === "USER" ? "Reported user" : "Author"}: {targetAuthor}
                                    </p>
                                    {report.targetType === "USER" && report.reportedUser?.status && (
                                      <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                        Account status: {report.reportedUser.status.toLowerCase()}
                                        {report.reportedUser.suspendedUntil
                                          ? ` until ${new Date(report.reportedUser.suspendedUntil).toLocaleString()}`
                                          : ""}
                                        {report.reportedUser.statusReason
                                          ? ` — ${report.reportedUser.statusReason}`
                                          : ""}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex min-w-[220px] flex-col gap-2">
                                  {userProfileHref && (
                                    <Link href={userProfileHref} className={`btn-secondary justify-center ${INTERACTIVE_FOCUS_RING}`}>
                                      View user profile
                                    </Link>
                                  )}
                                  {threadHref && (
                                    <Link href={threadHref} className={`btn-secondary justify-center ${INTERACTIVE_FOCUS_RING}`}>
                                      Open thread
                                    </Link>
                                  )}
                                  {canChooseUserSuspension && (
                                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-3">
                                      <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                        Suspension length
                                      </label>
                                      <div className="mt-2 flex items-center gap-2">
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min={1}
                                          max={MAX_USER_REPORT_SUSPENSION_DAYS}
                                          step={1}
                                          value={reportSuspensionDays}
                                          onChange={(event) =>
                                            setReportSuspensionDaysById((current) => ({
                                              ...current,
                                              [report.id]: event.target.value,
                                            }))
                                          }
                                          disabled={reportsActionKey !== null}
                                          className="w-full rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
                                        />
                                        <span className="text-sm text-[color:var(--muted-foreground)]">
                                          days
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {canModerateUserFromQueue ? (
                                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-3">
                                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                        Account moderation
                                      </p>
                                      <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                        Moderation reason
                                      </label>
                                      <textarea
                                        value={moderationReason}
                                        onChange={(event) =>
                                          setReportModerationReasonById((current) => ({
                                            ...current,
                                            [report.id]: event.target.value,
                                          }))
                                        }
                                        rows={3}
                                        maxLength={500}
                                        disabled={reportsActionKey !== null}
                                        className="mt-2 w-full rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
                                      />
                                      <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                                        {moderationReason.trim().length}/500 characters
                                      </p>

                                      <div className="mt-3 flex flex-col gap-2">
                                        {report.reportedUser?.status !== "BANNED" ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void runUserModerationAction(report, "suspend", {
                                                reason: moderationReason,
                                                suspensionDays: parsedReportSuspensionDays,
                                              })
                                            }
                                            disabled={
                                              reportsActionKey !== null ||
                                              !moderationReasonValid ||
                                              !reportSuspensionDaysValid
                                            }
                                            className={`btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                          >
                                            {reportsActionKey === `moderate:suspend:${report.id}`
                                              ? "Suspending..."
                                              : `Suspend account ${parsedReportSuspensionDays || 0} day${
                                                  parsedReportSuspensionDays === 1 ? "" : "s"
                                                }`}
                                          </button>
                                        ) : null}
                                        {report.reportedUser?.status !== "BANNED" ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void runUserModerationAction(report, "ban", {
                                                reason: moderationReason,
                                              })
                                            }
                                            disabled={
                                              reportsActionKey !== null || !moderationReasonValid
                                            }
                                            className={`btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                          >
                                            {reportsActionKey === `moderate:ban:${report.id}`
                                              ? "Banning..."
                                              : "Ban account"}
                                          </button>
                                        ) : null}
                                        {report.reportedUser?.status !== "ACTIVE" ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void runUserModerationAction(report, "unban")
                                            }
                                            disabled={reportsActionKey !== null}
                                            className={`btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                          >
                                            {reportsActionKey === `moderate:unban:${report.id}`
                                              ? "Lifting..."
                                              : "Lift restriction"}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                  {report.status === "PENDING" ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void runReportAction(
                                            report.id,
                                            "approve",
                                            canChooseUserSuspension
                                              ? { suspensionDays: parsedReportSuspensionDays }
                                              : undefined
                                          )
                                        }
                                        disabled={
                                          reportsActionKey !== null ||
                                          (canChooseUserSuspension && !reportSuspensionDaysValid)
                                        }
                                        className={`btn-primary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                      >
                                        {reportsActionKey === `approve:${report.id}`
                                          ? "Approving..."
                                          : canChooseUserSuspension
                                            ? `Approve and suspend ${parsedReportSuspensionDays || 0} day${
                                                parsedReportSuspensionDays === 1 ? "" : "s"
                                              }`
                                            : "Approve report"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void runReportAction(report.id, "dismiss")}
                                        disabled={reportsActionKey !== null}
                                        className={`btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                      >
                                        {reportsActionKey === `dismiss:${report.id}` ? "Rejecting..." : "Reject report"}
                                      </button>
                                      {report.reportCount > 1 ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void runReportAction(report.id, "dismiss", {
                                              dismissRelated: true,
                                            })
                                          }
                                          disabled={reportsActionKey !== null}
                                          className={`btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                        >
                                          {reportsActionKey === `dismiss:${report.id}`
                                            ? "Rejecting..."
                                            : dismissRelatedLabel}
                                        </button>
                                      ) : null}
                                    </>
                                  ) : (
                                    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-sm text-[color:var(--muted-foreground)]">
                                      This report is already {report.status.toLowerCase()}.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="space-y-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                        Appeals Queue
                      </h3>
                      <p className="text-sm text-[color:var(--muted-foreground)]">
                        Review account appeals from suspended or banned users and resolve them directly.
                      </p>
                    </div>

                    <label className="block max-w-xs space-y-1 text-sm">
                      <span className="font-semibold text-[color:var(--foreground)]">Appeal status</span>
                      <select
                        value={appealsStatus}
                        onChange={(event) => {
                          rememberScrollPosition(appealsScrollRestoreYRef);
                          setAppealsStatus(
                            event.target.value as "PENDING" | "APPROVED" | "REJECTED"
                          );
                        }}
                        className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)]"
                      >
                        <option value="PENDING">Pending</option>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                      </select>
                    </label>

                    {appealsNotice && (
                      <div
                        role={appealsNotice.toLowerCase().includes("failed") ? "alert" : "status"}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          appealsNotice.toLowerCase().includes("failed")
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        }`}
                      >
                        {appealsNotice}
                      </div>
                    )}

                    {appealsLoading ? (
                      <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                        Loading appeals queue...
                      </div>
                    ) : appealsQueue.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
                        No appeals match the current filter.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {appealsQueue.map((appeal) => (
                          <div
                            key={appeal.id}
                            className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                    Appeal #{appeal.id}
                                  </span>
                                  <span className="text-xs text-[color:var(--muted-foreground)]">
                                    Submitted {new Date(appeal.createdAt).toLocaleString()}
                                  </span>
                                </div>

                                <p className="text-sm font-semibold text-[color:var(--foreground)]">
                                  {appeal.user.username}
                                </p>
                                <p className="text-sm text-[color:var(--muted-foreground)]">
                                  Current status: {appeal.user.status.toLowerCase()}
                                  {appeal.user.statusReason ? ` — ${appeal.user.statusReason}` : ""}
                                </p>

                                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                    Appeal reason
                                  </p>
                                  <p className="mt-1 text-sm text-[color:var(--foreground)]">
                                    {appeal.reason}
                                  </p>
                                </div>
                              </div>

                              <div className="flex min-w-[220px] flex-col gap-2">
                                {appeal.status === "PENDING" ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void runAppealAction(appeal.id, "approve")}
                                      disabled={appealsActionKey !== null}
                                      className={`btn-primary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                    >
                                      {appealsActionKey === `approve:${appeal.id}` ? "Approving..." : "Approve appeal"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void runAppealAction(appeal.id, "reject")}
                                      disabled={appealsActionKey !== null}
                                      className={`btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                                    >
                                      {appealsActionKey === `reject:${appeal.id}` ? "Rejecting..." : "Reject appeal"}
                                    </button>
                                  </>
                                ) : (
                                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-2 text-sm text-[color:var(--muted-foreground)]">
                                    This appeal is already {appeal.status.toLowerCase()}.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          ) : activeTab === "account" && authSession ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                Signed in as <span className="font-semibold">{authSession.user.username}</span>
              </div>
              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                {authSession.user.status === "ACTIVE"
                  ? "Your account is active."
                  : `Your account is currently ${authSession.user.status.toLowerCase()}.`}
              </div>
              {authSession.user.statusReason ? (
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                  Restriction reason:{" "}
                  <span className="text-[color:var(--muted-foreground)]">
                    {authSession.user.statusReason}
                  </span>
                </div>
              ) : null}
              <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                You&apos;re signed in on this device.
                <span className="ml-1 text-[color:var(--muted-foreground)]">
                  For security, you may be asked to sign in again later.
                </span>
              </div>

              {authSession.user.status !== "ACTIVE" && pendingAppealLoading ? (
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                  Checking your appeal status...
                </div>
              ) : authSession.user.status !== "ACTIVE" && pendingAppeal ? (
                <div className="space-y-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                      We&apos;re Reviewing Your Appeal
                    </h3>
                    <p className="text-sm text-[color:var(--muted-foreground)]">
                      Your appeal is already in the review queue. You do not need to submit another one.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)]">
                    Submitted {new Date(pendingAppeal.createdAt).toLocaleString()}
                  </div>

                  <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                      Appeal reason
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--foreground)]">
                      {pendingAppeal.reason}
                    </p>
                  </div>
                </div>
              ) : authSession.user.status !== "ACTIVE" ? (
                <form
                  onSubmit={handleAppealSubmit}
                  className="space-y-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4"
                >
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                      Submit an Appeal
                    </h3>
                    <p className="text-sm text-[color:var(--muted-foreground)]">
                      If you believe your suspension or ban should be reviewed, explain the situation here.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="settings-appeal-reason"
                      className="text-sm font-semibold text-[color:var(--foreground)]"
                    >
                      Appeal reason
                    </label>
                    <textarea
                      id="settings-appeal-reason"
                      value={appealValues.reason}
                      onChange={(event) => updateAppealField("reason", event.target.value)}
                      rows={5}
                      maxLength={1000}
                      aria-invalid={Boolean(appealErrors.reason)}
                      aria-describedby={appealErrors.reason ? "settings-appeal-reason-error" : undefined}
                      className={`mt-1.5 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:ring-2 ${
                        appealErrors.reason
                          ? "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20"
                          : "border-[color:var(--surface-border)] focus:border-sky-400/70 focus:ring-sky-500/20"
                      }`}
                      disabled={appealSaveState === "saving"}
                    />
                    {appealErrors.reason ? (
                      <p id="settings-appeal-reason-error" className="mt-1 text-xs text-rose-300" role="alert">
                        {appealErrors.reason}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        {appealValues.reason.trim().length}/1000 characters
                      </p>
                    )}
                  </div>

                  {appealNotice && (
                    <p
                      role={appealSaveState === "error" ? "alert" : "status"}
                      aria-live={appealSaveState === "error" ? "assertive" : "polite"}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        appealSaveState === "error"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                          : appealSaveState === "success"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]"
                      }`}
                    >
                      {appealNotice}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={appealSaveState === "saving"}
                      className={`btn-primary h-10 rounded-lg px-4 disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                    >
                      {appealSaveState === "saving" ? "Submitting..." : "Submit appeal"}
                    </button>
                  </div>
                </form>
              ) : null}

              {isGoogleAccount ? (
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
                  <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                    Change Password
                  </h3>
                  <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                    This account uses Google sign-in. Password management happens through your Google account.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handlePasswordSave}
                  aria-busy={accountSaveState === "saving"}
                  className="space-y-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4"
                >
                  <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                    Change Password
                  </h3>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="settings-current-password"
                        className="text-sm font-semibold text-[color:var(--foreground)]"
                      >
                        Current Password
                      </label>
                      <input
                        id="settings-current-password"
                        type="password"
                        value={accountValues.currentPassword}
                        onChange={(event) =>
                          updateAccountField("currentPassword", event.target.value)
                        }
                        aria-invalid={Boolean(accountErrors.currentPassword)}
                        aria-describedby={
                          accountErrors.currentPassword
                            ? "settings-current-password-error"
                            : undefined
                        }
                        className={`mt-1.5 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:ring-2 ${
                          accountErrors.currentPassword
                            ? "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20"
                            : "border-[color:var(--surface-border)] focus:border-sky-400/70 focus:ring-sky-500/20"
                        }`}
                        autoComplete="current-password"
                        disabled={accountSaveState === "saving"}
                      />
                      {accountErrors.currentPassword && (
                        <p
                          id="settings-current-password-error"
                          className="mt-1 text-xs text-rose-300"
                          role="alert"
                        >
                          {accountErrors.currentPassword}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="settings-new-password"
                        className="text-sm font-semibold text-[color:var(--foreground)]"
                      >
                        New Password
                      </label>
                      <input
                        id="settings-new-password"
                        type="password"
                        value={accountValues.newPassword}
                        onChange={(event) =>
                          updateAccountField("newPassword", event.target.value)
                        }
                        aria-invalid={Boolean(accountErrors.newPassword)}
                        aria-describedby={
                          accountErrors.newPassword
                            ? "settings-new-password-error"
                            : undefined
                        }
                        className={`mt-1.5 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:ring-2 ${
                          accountErrors.newPassword
                            ? "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20"
                            : "border-[color:var(--surface-border)] focus:border-sky-400/70 focus:ring-sky-500/20"
                        }`}
                        autoComplete="new-password"
                        disabled={accountSaveState === "saving"}
                      />
                      {accountErrors.newPassword && (
                        <p
                          id="settings-new-password-error"
                          className="mt-1 text-xs text-rose-300"
                          role="alert"
                        >
                          {accountErrors.newPassword}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="settings-confirm-password"
                        className="text-sm font-semibold text-[color:var(--foreground)]"
                      >
                        Confirm New Password
                      </label>
                      <input
                        id="settings-confirm-password"
                        type="password"
                        value={accountValues.confirmPassword}
                        onChange={(event) =>
                          updateAccountField("confirmPassword", event.target.value)
                        }
                        aria-invalid={Boolean(accountErrors.confirmPassword)}
                        aria-describedby={
                          accountErrors.confirmPassword
                            ? "settings-confirm-password-error"
                            : undefined
                        }
                        className={`mt-1.5 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:ring-2 ${
                          accountErrors.confirmPassword
                            ? "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20"
                            : "border-[color:var(--surface-border)] focus:border-sky-400/70 focus:ring-sky-500/20"
                        }`}
                        autoComplete="new-password"
                        disabled={accountSaveState === "saving"}
                      />
                      {accountErrors.confirmPassword && (
                        <p
                          id="settings-confirm-password-error"
                          className="mt-1 text-xs text-rose-300"
                          role="alert"
                        >
                          {accountErrors.confirmPassword}
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-[color:var(--muted-foreground)]">
                    Use at least 8 characters with at least one letter and one number.
                  </p>

                  {accountNotice && (
                    <p
                      role={accountSaveState === "error" ? "alert" : "status"}
                      aria-live={accountSaveState === "error" ? "assertive" : "polite"}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        accountSaveState === "error"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                          : accountSaveState === "success"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]"
                      }`}
                    >
                      {accountNotice}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={accountSaveState === "saving"}
                      className={`btn-primary h-10 rounded-lg px-4 disabled:cursor-not-allowed disabled:opacity-60 ${INTERACTIVE_FOCUS_RING}`}
                    >
                      {accountSaveState === "saving"
                        ? "Updating..."
                        : "Update Password"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <>
              <div className="mt-5 space-y-3">
                {copy.bullets.map((bullet) => (
                  <div
                    key={bullet}
                    className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)]"
                  >
                    {bullet}
                  </div>
                ))}
              </div>

              <p className="mt-5 text-xs text-[color:var(--muted-foreground)]">
                Additional controls for this section are being rolled out. Check back
                after future updates.
              </p>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
