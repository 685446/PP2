"use client";

import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import {
  persistAuthSession,
  type LoginSuccessPayload,
} from "@/components/auth/session";

type GoogleAuthMode = "signin" | "signup";

type GoogleAuthButtonProps = {
  mode: GoogleAuthMode;
  favoriteTeamId?: number | null;
};

type GoogleCredentialResponse = {
  credential?: string;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?:
                | "signin_with"
                | "signup_with"
                | "continue_with"
                | "signin"
                | "signup"
                | "continue";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: string | number;
              logo_alignment?: "left" | "center";
            }
          ) => void;
        };
      };
    };
  }
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

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6.1-2.8-6.1-6.2s2.8-6.2 6.1-6.2c1.9 0 3.2.8 4 1.5l2.7-2.6C17 2.9 14.7 2 12 2 6.9 2 2.8 6.2 2.8 11.4S6.9 20.8 12 20.8c6.9 0 9.1-4.8 9.1-7.2 0-.5-.1-.9-.1-1.3z"
      />
      <path
        fill="#34A853"
        d="M3.8 7.4l3.2 2.3c.9-1.9 2.8-3.2 5-3.2 1.9 0 3.2.8 4 1.5l2.7-2.6C17 2.9 14.7 2 12 2 8.4 2 5.3 4.1 3.8 7.4z"
      />
      <path
        fill="#4A90E2"
        d="M12 20.8c2.6 0 4.9-.9 6.5-2.4l-3-2.5c-.8.6-1.9 1-3.5 1-3.9 0-5.3-2.6-5.5-3.9l-3.2 2.5c1.5 3.4 4.9 5.3 8.7 5.3z"
      />
      <path
        fill="#FBBC05"
        d="M3.3 15.5l3.2-2.5c-.2-.6-.3-1.1-.3-1.7s.1-1.2.3-1.7L3.3 7.1C2.8 8.3 2.5 9.8 2.5 11.3c0 1.6.3 3 .8 4.2z"
      />
    </svg>
  );
}

function FallbackButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--foreground)] shadow-[0_1px_2px_rgba(2,8,23,0.04)] opacity-80"
    >
      <GoogleIcon />
      {label}
    </button>
  );
}

export default function GoogleAuthButton({
  mode,
  favoriteTeamId = null,
}: GoogleAuthButtonProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buttonWidth, setButtonWidth] = useState(0);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (window.google?.accounts?.id) {
      setScriptReady(true);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(
        containerRef.current?.getBoundingClientRect().width ?? 0
      );
      if (nextWidth > 0) {
        setButtonWidth((current) => (current === nextWidth ? current : nextWidth));
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(containerRef.current);
    window.addEventListener("resize", updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !buttonRef.current || !clientId || buttonWidth <= 0) return;
    const googleId = window.google?.accounts?.id;
    if (!googleId) return;

    buttonRef.current.innerHTML = "";
    googleId.initialize({
      client_id: clientId,
      callback: async (response) => {
        if (!response.credential) {
          setError("Google sign-in did not return a credential.");
          return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
          const apiResponse = await fetch("/api/auth/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              credential: response.credential,
              favoriteTeamId,
            }),
          });

          const payload = (await apiResponse
            .json()
            .catch(() => ({}))) as Partial<LoginSuccessPayload> & { error?: string };

          if (!apiResponse.ok) {
            setError(
              parseApiError(payload, "Google authentication failed. Please try again.")
            );
            return;
          }

          if (
            !payload.accessToken ||
            !payload.refreshToken ||
            !payload.expiresIn ||
            !payload.user
          ) {
            setError("Google authentication response was incomplete.");
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
        } catch {
          setError("Unable to reach the server. Please try again.");
        } finally {
          setIsSubmitting(false);
        }
      },
    });

    googleId.renderButton(buttonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: mode === "signup" ? "signup_with" : "continue_with",
      shape: "rectangular",
      width: buttonWidth,
      logo_alignment: "left",
    });
  }, [buttonWidth, clientId, favoriteTeamId, mode, router, scriptReady]);

  if (!clientId) {
    return (
      <div className="mx-auto w-full max-w-[360px] space-y-2">
        <FallbackButton label={mode === "signup" ? "Sign up with Google" : "Continue with Google"} />
        <p className="text-center text-xs text-[color:var(--muted-foreground)]">
          Set{" "}
          <code className="rounded bg-[color:var(--surface-elevated)] px-1 py-0.5 text-[color:var(--foreground)]">
            NEXT_PUBLIC_GOOGLE_CLIENT_ID
          </code>{" "}
          in{" "}
          <code className="rounded bg-[color:var(--surface-elevated)] px-1 py-0.5 text-[color:var(--foreground)]">
            .env
          </code>{" "}
          and
          restart{" "}
          <code className="rounded bg-[color:var(--surface-elevated)] px-1 py-0.5 text-[color:var(--foreground)]">
            npm run dev
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-[360px] space-y-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      {!scriptReady ? (
        <FallbackButton label="Loading Google..." />
      ) : (
        <div
          className={`w-full ${
            isSubmitting ? "pointer-events-none opacity-70" : ""
          }`}
        >
          <div
            ref={buttonRef}
            className="w-full [&>div]:mx-auto [&_iframe]:mx-auto [&_iframe]:block"
          />
        </div>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
