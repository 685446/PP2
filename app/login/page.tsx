"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import { persistAuthSession, type LoginSuccessPayload } from "@/components/auth/session";
import type { LoginFormValues } from "@/components/auth/validation";
import { validateLogin } from "@/components/auth/validation";

const baseFieldClass =
  "mt-1 w-full rounded-xl border bg-[color:var(--surface)] px-3 py-2.5 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] outline-none transition focus:ring-2";
const validFieldClass = "border-[color:var(--surface-border)] focus:border-sky-400/80 focus:ring-sky-500/20";
const invalidFieldClass = "border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/20";

type LoginField = "email" | "password";
type LoginTouched = Partial<Record<LoginField, boolean>>;
type LoginErrors = Partial<Record<LoginField, string>>;

export default function LoginPage() {
  const router = useRouter();
  const [values, setValues] = useState<LoginFormValues>({
    email: "",
    password: "",
    rememberMe: false,
  });
  const [touched, setTouched] = useState<LoginTouched>({});
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<LoginErrors>({});

  const clientErrors = useMemo(() => validateLogin(values), [values]);

  function getFieldError(field: LoginField): string | undefined {
    return serverErrors[field] ?? clientErrors[field];
  }

  function shouldShowError(field: LoginField): boolean {
    if (serverErrors[field]) return true;
    const nextError = clientErrors[field];
    if (!nextError) return false;

    const fieldValue = values[field];
    const isEmpty =
      typeof fieldValue === "string" ? fieldValue.trim().length === 0 : !fieldValue;

    if (isEmpty) {
      return submitted;
    }

    return Boolean(touched[field] || submitted);
  }

  function fieldClass(field: LoginField): string {
    return `${baseFieldClass} ${shouldShowError(field) ? invalidFieldClass : validFieldClass}`;
  }

  function updateField<K extends keyof LoginFormValues>(key: K, value: LoginFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setApiError(null);
    if (key === "email" || key === "password") {
      setServerErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setApiError(null);
    setServerErrors({});

    if (Object.keys(clientErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email.trim(),
          password: values.password,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<LoginSuccessPayload> & {
        error?: string;
      };

      if (!response.ok) {
        const message = payload.error ?? "Sign in failed. Please try again.";

        if (response.status === 401) {
          setServerErrors({
            email: "Invalid email or password.",
            password: "Invalid email or password.",
          });
        }

        setApiError(message);
        return;
      }

      if (!payload.accessToken || !payload.refreshToken || !payload.user || !payload.expiresIn) {
        setApiError("Login response was incomplete. Please try again.");
        return;
      }

      persistAuthSession(
        {
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          expiresIn: payload.expiresIn,
          user: payload.user,
        },
        values.rememberMe
      );
      router.push("/");
      router.refresh();
    } catch {
      setApiError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome Back"
      subtitle="Sign in to your SportsDeck account to jump back into discussions, polls, and team updates."
      highlights={[
        "Track your favorite team with a personalized feed.",
        "Join active match threads and fan discussions instantly.",
        "Receive moderation-safe, community-first updates.",
      ]}
      footer={
        <>
          New to SportsDeck?{" "}
          <Link href="/register" className="font-semibold text-sky-300 transition hover:text-sky-200">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4 sm:space-y-5" noValidate onSubmit={handleSubmit}>
        {submitted && Object.keys(clientErrors).length > 0 && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            Please fix the highlighted fields before continuing.
          </p>
        )}

        {apiError && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {apiError}
          </p>
        )}

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
            onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
            aria-invalid={shouldShowError("email")}
            aria-describedby={shouldShowError("email") ? "email-error" : undefined}
            className={fieldClass("email")}
          />
          {shouldShowError("email") && (
            <p id="email-error" className="mt-1 text-xs text-rose-300">
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
            autoComplete="current-password"
            placeholder="Enter your password"
            value={values.password}
            onChange={(event) => updateField("password", event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
            aria-invalid={shouldShowError("password")}
            aria-describedby={shouldShowError("password") ? "password-error" : undefined}
            className={fieldClass("password")}
          />
          {shouldShowError("password") && (
            <p id="password-error" className="mt-1 text-xs text-rose-300">
              {getFieldError("password")}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex items-center gap-2 text-[color:var(--foreground)]">
            <input
              type="checkbox"
              checked={values.rememberMe}
              onChange={(event) => updateField("rememberMe", event.target.checked)}
              className="h-4 w-4 rounded border-[color:var(--surface-border)] bg-[color:var(--surface)] text-sky-500"
            />
            Remember me
          </label>
          <button
            type="button"
            className="text-[color:var(--muted-foreground)] transition hover:text-[color:var(--foreground)]"
          >
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary h-11 w-full justify-center rounded-xl text-base disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>

        <div className="flex items-center gap-3 pt-1">
          <span className="h-px flex-1 bg-[color:var(--surface-border)]" />
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
            or continue with
          </span>
          <span className="h-px flex-1 bg-[color:var(--surface-border)]" />
        </div>

        <GoogleAuthButton mode="signin" />
      </form>
    </AuthShell>
  );
}
