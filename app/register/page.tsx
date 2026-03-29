"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import { persistAuthSession, type LoginSuccessPayload } from "@/components/auth/session";
import type { RegisterErrors, RegisterFormValues } from "@/components/auth/validation";
import { validateRegister } from "@/components/auth/validation";

const baseFieldClass =
  "mt-1 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] outline-none transition focus:ring-2";
const validFieldClass = "border-[color:var(--surface-border)] focus:border-sky-400/80 focus:ring-sky-500/20";
const invalidFieldClass = "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20";

type RegisterField = keyof RegisterErrors;
type RegisterTouched = Partial<Record<RegisterField, boolean>>;
type TeamOption = { id: number; name: string };

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

export default function RegisterPage() {
  const router = useRouter();
  const [values, setValues] = useState<RegisterFormValues>({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    favoriteTeam: "",
    acceptTerms: false,
  });
  const [touched, setTouched] = useState<RegisterTouched>({});
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsLoadError, setTeamsLoadError] = useState<string | null>(null);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<RegisterErrors>({});

  const clientErrors = useMemo(() => validateRegister(values), [values]);
  const googleFavoriteTeamId = values.favoriteTeam
    ? Number(values.favoriteTeam)
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      setTeamsLoading(true);
      setTeamsLoadError(null);
      try {
        const response = await fetch("/api/teams", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          data?: Array<{ id?: number; name?: string }>;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load teams.");
        }

        const options = Array.isArray(payload.data)
          ? payload.data
              .filter((team): team is { id: number; name: string } => typeof team?.id === "number" && typeof team?.name === "string")
              .map((team) => ({ id: team.id, name: team.name }))
          : [];

        if (!cancelled) setTeamOptions(options);
      } catch {
        if (!cancelled) {
          setTeamsLoadError("Teams are unavailable right now. You can still continue without selecting one.");
        }
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    }

    loadTeams();
    return () => {
      cancelled = true;
    };
  }, []);

  function getFieldError(field: RegisterField): string | undefined {
    return serverErrors[field] ?? clientErrors[field];
  }

  function shouldShowError(field: RegisterField): boolean {
    if (serverErrors[field]) return true;
    return Boolean((touched[field] || submitted) && clientErrors[field]);
  }

  function fieldClass(field: RegisterField): string {
    return `${baseFieldClass} ${shouldShowError(field) ? invalidFieldClass : validFieldClass}`;
  }

  function updateField<K extends keyof RegisterFormValues>(key: K, value: RegisterFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setApiError(null);
    if (key in serverErrors) {
      setServerErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function markFieldTouched(field: RegisterField) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  async function loginAfterRegister(email: string, password: string): Promise<void> {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<LoginSuccessPayload> & {
      error?: string;
    };

    if (!response.ok || !payload.accessToken || !payload.refreshToken || !payload.user || !payload.expiresIn) {
      router.push("/login");
      return;
    }

    persistAuthSession(
      {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresIn: payload.expiresIn,
        user: payload.user,
      },
      true
    );
    router.push("/");
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setApiError(null);
    setServerErrors({});

    if (Object.keys(clientErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const parsedFavoriteTeam = values.favoriteTeam ? Number(values.favoriteTeam) : null;
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email.trim(),
          username: values.username.trim(),
          password: values.password,
          favoriteTeamId: Number.isNaN(parsedFavoriteTeam) ? null : parsedFavoriteTeam,
          acceptTerms: values.acceptTerms,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        const message = parseApiError(payload, "Registration failed. Please try again.");
        const nextServerErrors: RegisterErrors = {};

        if (message.toLowerCase().includes("email")) nextServerErrors.email = message;
        if (message.toLowerCase().includes("username")) nextServerErrors.username = message;
        if (message.toLowerCase().includes("favorite team")) nextServerErrors.favoriteTeam = message;
        if (message.toLowerCase().includes("guidelines")) nextServerErrors.acceptTerms = message;

        setServerErrors(nextServerErrors);
        setApiError(message);
        return;
      }

      await loginAfterRegister(values.email.trim(), values.password);
    } catch {
      setApiError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create Account"
      subtitle="Join SportsDeck to connect with Premier League fans, post threads, and vote in matchday polls."
      highlights={[
        "Create threads and polls for your team community.",
        "Follow users and build your own matchday network.",
        "Vote in fan polls and shape matchday conversations.",
      ]}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-sky-300 transition hover:text-sky-200">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4 sm:space-y-5" noValidate onSubmit={handleSubmit}>
        {submitted && Object.keys(clientErrors).length > 0 && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            Please fix the highlighted fields before creating your account.
          </p>
        )}

        {apiError && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {apiError}
          </p>
        )}

        <div>
          <label htmlFor="username" className="text-sm font-medium text-[color:var(--foreground)]">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder="Choose a username"
            value={values.username}
            onChange={(event) => updateField("username", event.target.value)}
            onBlur={() => markFieldTouched("username")}
            aria-invalid={shouldShowError("username")}
            aria-describedby={shouldShowError("username") ? "username-error" : undefined}
            className={fieldClass("username")}
          />
          {shouldShowError("username") && (
            <p id="username-error" className="mt-1 text-xs text-rose-300">
              {getFieldError("username")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="text-sm font-medium text-[color:var(--foreground)]">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="Enter your email"
            value={values.email}
            onChange={(event) => updateField("email", event.target.value)}
            onBlur={() => markFieldTouched("email")}
            aria-invalid={shouldShowError("email")}
            aria-describedby={shouldShowError("email") ? "register-email-error" : undefined}
            className={fieldClass("email")}
          />
          {shouldShowError("email") && (
            <p id="register-email-error" className="mt-1 text-xs text-rose-300">
              {getFieldError("email")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="text-sm font-medium text-[color:var(--foreground)]">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            value={values.password}
            onChange={(event) => updateField("password", event.target.value)}
            onBlur={() => markFieldTouched("password")}
            aria-invalid={shouldShowError("password")}
            aria-describedby={shouldShowError("password") ? "register-password-error" : undefined}
            className={fieldClass("password")}
          />
          {shouldShowError("password") && (
            <p id="register-password-error" className="mt-1 text-xs text-rose-300">
              {getFieldError("password")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="text-sm font-medium text-[color:var(--foreground)]">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={values.confirmPassword}
            onChange={(event) => updateField("confirmPassword", event.target.value)}
            onBlur={() => markFieldTouched("confirmPassword")}
            aria-invalid={shouldShowError("confirmPassword")}
            aria-describedby={shouldShowError("confirmPassword") ? "confirm-password-error" : undefined}
            className={fieldClass("confirmPassword")}
          />
          {shouldShowError("confirmPassword") && (
            <p id="confirm-password-error" className="mt-1 text-xs text-rose-300">
              {getFieldError("confirmPassword")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="favoriteTeam" className="text-sm font-medium text-[color:var(--foreground)]">
            Favorite Team (optional)
          </label>
          <select
            id="favoriteTeam"
            name="favoriteTeam"
            className={fieldClass("favoriteTeam")}
            value={values.favoriteTeam}
            onChange={(event) => updateField("favoriteTeam", event.target.value)}
            onBlur={() => markFieldTouched("favoriteTeam")}
          >
            <option value="">No favorite team selected</option>
            {teamsLoading && <option disabled>Loading teams...</option>}
            {!teamsLoading &&
              teamOptions.map((team) => (
                <option key={team.id} value={String(team.id)}>
                  {team.name}
                </option>
              ))}
          </select>
          {teamsLoadError && <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">{teamsLoadError}</p>}
          {shouldShowError("favoriteTeam") && (
            <p className="mt-1 text-xs text-rose-300">{getFieldError("favoriteTeam")}</p>
          )}
        </div>

        <label className="inline-flex items-start gap-2 text-sm text-[color:var(--foreground)]">
          <input
            type="checkbox"
            checked={values.acceptTerms}
            onChange={(event) => updateField("acceptTerms", event.target.checked)}
            onBlur={() => markFieldTouched("acceptTerms")}
            aria-invalid={shouldShowError("acceptTerms")}
            className={`mt-0.5 h-4 w-4 rounded bg-[color:var(--surface)] text-sky-500 ${
              shouldShowError("acceptTerms") ? "border-rose-500/80" : "border-[color:var(--surface-border)]"
            }`}
          />
          <span>I agree to the community guidelines and terms of use.</span>
        </label>
        {shouldShowError("acceptTerms") && (
          <p className="-mt-2 text-xs text-rose-300">{getFieldError("acceptTerms")}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary h-11 w-full justify-center rounded-xl text-base disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Creating Account..." : "Create Account"}
        </button>

        <div className="flex items-center gap-3 pt-1">
          <span className="h-px flex-1 bg-[color:var(--surface-border)]" />
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
            or continue with
          </span>
          <span className="h-px flex-1 bg-[color:var(--surface-border)]" />
        </div>

        <GoogleAuthButton
          mode="signup"
          favoriteTeamId={
            Number.isFinite(googleFavoriteTeamId) ? googleFavoriteTeamId : null
          }
        />
      </form>
    </AuthShell>
  );
}
