const DEFAULT_REVALIDATE_SECONDS = 300;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getLeagueCode(): string {
  return process.env.SPORTS_LEAGUE_CODE || "PL";
}

export function buildCompetitionPath(resource: string, query: Record<string, string | number | undefined | null> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  const leagueCode = getLeagueCode();
  const path = `/competitions/${leagueCode}/${resource}`;
  return queryString ? `${path}?${queryString}` : path;
}

export async function sportsFetch(path: string, options: { revalidate?: number } = {}) {
  const baseUrl = getRequiredEnv("SPORTS_API_BASE_URL");
  const apiKey = getRequiredEnv("SPORTS_API_KEY");
  const revalidate = options.revalidate ?? DEFAULT_REVALIDATE_SECONDS;

  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "X-Auth-Token": apiKey },
    next: { revalidate },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof payload?.message === "string" ? payload.message : "Unknown error";
    throw new Error(`Sports API request failed (${response.status}): ${detail}`);
  }

  return payload;
}