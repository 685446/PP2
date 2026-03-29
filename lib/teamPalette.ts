type TeamPalette = {
  primaryRgb: string;
  secondaryRgb: string;
  source: "manual" | "crest" | "hash";
};

type TeamIdentity = {
  id?: number | null;
  externalId?: string | null;
  name?: string | null;
  crestUrl?: string | null;
};

const DEFAULT_PALETTE: TeamPalette = {
  primaryRgb: "56,189,248",
  secondaryRgb: "16,185,129",
  source: "hash",
};

const TEAM_PALETTE_CACHE = new Map<string, TeamPalette>();
const CREST_PALETTE_CACHE = new Map<string, TeamPalette | null>();
const IN_FLIGHT_CACHE = new Map<string, Promise<TeamPalette>>();

const MANUAL_RULES: Array<{ pattern: RegExp; primaryRgb: string; secondaryRgb: string }> = [
  { pattern: /arsenal/i, primaryRgb: "220,38,38", secondaryRgb: "185,28,28" },
  { pattern: /chelsea/i, primaryRgb: "37,99,235", secondaryRgb: "29,78,216" },
  { pattern: /liverpool/i, primaryRgb: "220,38,38", secondaryRgb: "180,83,9" },
  { pattern: /manchester city|man city/i, primaryRgb: "14,165,233", secondaryRgb: "59,130,246" },
  { pattern: /manchester united|man united/i, primaryRgb: "220,38,38", secondaryRgb: "234,179,8" },
  { pattern: /tottenham/i, primaryRgb: "15,23,42", secondaryRgb: "148,163,184" },
  { pattern: /newcastle/i, primaryRgb: "2,6,23", secondaryRgb: "156,163,175" },
];

function clamp(n: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, n));
}

function rgbToString(r: number, g: number, b: number) {
  return `${clamp(r)},${clamp(g)},${clamp(b)}`;
}

function parseHexToRgb(hex: string): [number, number, number] | null {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 3 && raw.length !== 6) return null;
  const normalized = raw.length === 3 ? raw.split("").map((c) => `${c}${c}`).join("") : raw;
  const n = Number.parseInt(normalized, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseRgbFunctionToRgb(token: string): [number, number, number] | null {
  const match = token
    .replace(/\s+/g, "")
    .match(/^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,([01](?:\.\d+)?|0?\.\d+))?\)$/i);

  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha < 0.2) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function shouldKeepColor(rgb: [number, number, number]) {
  const [r, g, b] = rgb;
  const { s, l } = toHsl(r, g, b);
  // Drop near-neutral and near-extreme colors.
  if (s < 0.12) return false;
  if (l < 0.08 || l > 0.92) return false;
  return true;
}

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function fallbackPalette(seedInput: string): TeamPalette {
  const seed = hashString(seedInput || "sportsdeck");
  const hue = seed % 360;
  const [r1, g1, b1] = hslToRgb(hue, 0.68, 0.46);
  const [r2, g2, b2] = hslToRgb((hue + 34) % 360, 0.62, 0.40);
  return {
    primaryRgb: rgbToString(r1, g1, b1),
    secondaryRgb: rgbToString(r2, g2, b2),
    source: "hash",
  };
}

function manualPalette(teamName?: string | null): TeamPalette | null {
  if (!teamName) return null;
  const rule = MANUAL_RULES.find((entry) => entry.pattern.test(teamName));
  if (!rule) return null;
  return {
    primaryRgb: rule.primaryRgb,
    secondaryRgb: rule.secondaryRgb,
    source: "manual",
  };
}

function teamCacheKey(team: TeamIdentity) {
  if (team.id) return `id:${team.id}`;
  if (team.externalId) return `ext:${team.externalId}`;
  if (team.name) return `name:${team.name.trim().toLowerCase()}`;
  if (team.crestUrl) return `crest:${team.crestUrl}`;
  return "unknown";
}

async function extractPaletteFromSvg(crestUrl: string): Promise<TeamPalette | null> {
  if (CREST_PALETTE_CACHE.has(crestUrl)) return CREST_PALETTE_CACHE.get(crestUrl) ?? null;

  try {
    const response = await fetch(crestUrl, { cache: "no-store" });
    if (!response.ok) {
      CREST_PALETTE_CACHE.set(crestUrl, null);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();
    const looksSvg = contentType.includes("svg") || raw.includes("<svg");
    if (!looksSvg) {
      CREST_PALETTE_CACHE.set(crestUrl, null);
      return null;
    }

    const colorTokenRegex = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b|rgba?\([^)]+\)/g;
    const tokens = raw.match(colorTokenRegex) ?? [];

    if (tokens.length === 0) {
      CREST_PALETTE_CACHE.set(crestUrl, null);
      return null;
    }

    const counts = new Map<string, { rgb: [number, number, number]; count: number }>();
    for (const token of tokens) {
      let rgb: [number, number, number] | null = null;
      if (token.startsWith("#")) rgb = parseHexToRgb(token);
      else rgb = parseRgbFunctionToRgb(token);
      if (!rgb || !shouldKeepColor(rgb)) continue;

      const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { rgb, count: 1 });
    }

    const sorted = Array.from(counts.values()).sort((a, b) => b.count - a.count);
    if (sorted.length === 0) {
      CREST_PALETTE_CACHE.set(crestUrl, null);
      return null;
    }

    const primary = sorted[0].rgb;
    const secondaryCandidate = sorted.find((entry) => colorDistance(primary, entry.rgb) >= 56)?.rgb ?? null;
    const secondary = secondaryCandidate ?? hslToRgb((toHsl(primary[0], primary[1], primary[2]).h + 28) % 360, 0.6, 0.42);

    const palette: TeamPalette = {
      primaryRgb: rgbToString(primary[0], primary[1], primary[2]),
      secondaryRgb: rgbToString(secondary[0], secondary[1], secondary[2]),
      source: "crest",
    };
    CREST_PALETTE_CACHE.set(crestUrl, palette);
    return palette;
  } catch {
    CREST_PALETTE_CACHE.set(crestUrl, null);
    return null;
  }
}

export async function getTeamPalette(team: TeamIdentity): Promise<TeamPalette> {
  const key = teamCacheKey(team);
  const cached = TEAM_PALETTE_CACHE.get(key);
  if (cached) return cached;

  const inFlight = IN_FLIGHT_CACHE.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const manual = manualPalette(team.name);
    if (manual) {
      TEAM_PALETTE_CACHE.set(key, manual);
      return manual;
    }

    if (team.crestUrl) {
      const extracted = await extractPaletteFromSvg(team.crestUrl);
      if (extracted) {
        TEAM_PALETTE_CACHE.set(key, extracted);
        return extracted;
      }
    }

    const fallback = fallbackPalette(team.name || team.externalId || String(team.id || "") || team.crestUrl || "sportsdeck");
    TEAM_PALETTE_CACHE.set(key, fallback);
    return fallback;
  })();

  IN_FLIGHT_CACHE.set(key, promise);
  try {
    return await promise;
  } finally {
    IN_FLIGHT_CACHE.delete(key);
  }
}

export async function warmTeamPaletteCache(teams: TeamIdentity[]) {
  if (!Array.isArray(teams) || teams.length === 0) return;
  await Promise.allSettled(teams.map((team) => getTeamPalette(team)));
}

export type { TeamPalette, TeamIdentity };
