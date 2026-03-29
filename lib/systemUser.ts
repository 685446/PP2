export const SYSTEM_USER_EMAIL =
  process.env.SYSTEM_USER_EMAIL || "system@sportsdeck.com";
export const SYSTEM_USER_USERNAME =
  process.env.SYSTEM_USER_USERNAME || "SportsDeck Bot";
export const SYSTEM_USER_AVATAR =
  process.env.SYSTEM_USER_AVATAR || "/branding/logo_full_color_notext.png";
export const SYSTEM_USER_BIO =
  "Automated account for match threads and moderation actions";
export const SYSTEM_USER_BADGE = "Official";

export function isSystemUsername(username: string | null | undefined) {
  const normalized = (username || "").trim().toLowerCase();
  return normalized === SYSTEM_USER_USERNAME.toLowerCase() || normalized === "system";
}

export function isSystemIdentity(input: {
  username?: string | null;
  avatar?: string | null;
}) {
  return (
    isSystemUsername(input.username) ||
    (input.avatar || "").trim() === SYSTEM_USER_AVATAR
  );
}
