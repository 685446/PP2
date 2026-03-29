import type { CSSProperties } from "react";

type TeamColorRule = {
  pattern: RegExp;
  primaryRgb: string;
  secondaryRgb: string;
  primaryLabel?: string;
  secondaryLabel?: string;
};

const TEAM_COLOR_RULES: TeamColorRule[] = [
  { pattern: /premier league general/i, primaryRgb: "14,165,233", secondaryRgb: "34,197,94", primaryLabel: "Sky", secondaryLabel: "Emerald" },
  { pattern: /arsenal/i, primaryRgb: "220,38,38", secondaryRgb: "234,179,8", primaryLabel: "Red", secondaryLabel: "Gold" },
  { pattern: /aston villa/i, primaryRgb: "127,29,29", secondaryRgb: "125,211,252", primaryLabel: "Claret", secondaryLabel: "Sky Blue" },
  { pattern: /bournemouth/i, primaryRgb: "220,38,38", secondaryRgb: "15,23,42", primaryLabel: "Red", secondaryLabel: "Black" },
  { pattern: /brentford/i, primaryRgb: "220,38,38", secondaryRgb: "241,245,249", primaryLabel: "Red", secondaryLabel: "White" },
  { pattern: /brighton/i, primaryRgb: "37,99,235", secondaryRgb: "241,245,249", primaryLabel: "Blue", secondaryLabel: "White" },
  { pattern: /burnley/i, primaryRgb: "127,29,29", secondaryRgb: "125,211,252", primaryLabel: "Claret", secondaryLabel: "Sky Blue" },
  { pattern: /chelsea/i, primaryRgb: "37,99,235", secondaryRgb: "15,23,42", primaryLabel: "Blue", secondaryLabel: "Black" },
  { pattern: /crystal palace/i, primaryRgb: "220,38,38", secondaryRgb: "37,99,235", primaryLabel: "Red", secondaryLabel: "Blue" },
  { pattern: /everton/i, primaryRgb: "29,78,216", secondaryRgb: "241,245,249", primaryLabel: "Blue", secondaryLabel: "White" },
  { pattern: /fulham/i, primaryRgb: "241,245,249", secondaryRgb: "15,23,42", primaryLabel: "White", secondaryLabel: "Black" },
  { pattern: /leeds/i, primaryRgb: "241,245,249", secondaryRgb: "37,99,235", primaryLabel: "White", secondaryLabel: "Blue" },
  { pattern: /liverpool/i, primaryRgb: "220,38,38", secondaryRgb: "22,163,74", primaryLabel: "Red", secondaryLabel: "Green" },
  { pattern: /manchester city|man city/i, primaryRgb: "125,211,252", secondaryRgb: "30,58,138", primaryLabel: "Sky Blue", secondaryLabel: "Navy" },
  { pattern: /manchester united|man united/i, primaryRgb: "220,38,38", secondaryRgb: "234,179,8", primaryLabel: "Red", secondaryLabel: "Gold" },
  { pattern: /newcastle/i, primaryRgb: "15,23,42", secondaryRgb: "241,245,249", primaryLabel: "Black", secondaryLabel: "White" },
  { pattern: /nottingham forest/i, primaryRgb: "220,38,38", secondaryRgb: "241,245,249", primaryLabel: "Red", secondaryLabel: "White" },
  { pattern: /sunderland/i, primaryRgb: "220,38,38", secondaryRgb: "241,245,249", primaryLabel: "Red", secondaryLabel: "White" },
  { pattern: /tottenham/i, primaryRgb: "30,58,138", secondaryRgb: "241,245,249", primaryLabel: "Navy", secondaryLabel: "White" },
  { pattern: /west ham/i, primaryRgb: "127,29,29", secondaryRgb: "234,179,8", primaryLabel: "Claret", secondaryLabel: "Gold" },
  { pattern: /wolves|wolverhampton/i, primaryRgb: "234,179,8", secondaryRgb: "15,23,42", primaryLabel: "Gold", secondaryLabel: "Black" },
];

export type CommunityPalette = {
  primaryRgb: string;
  secondaryRgb: string;
  primaryLabel: string;
  secondaryLabel: string;
  source: "manual" | "generated";
};

function stringHue(input: string, offset = 0) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 360;
  }
  return (hash + offset) % 360;
}

function hslToRgbString(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const r = Math.round((rPrime + m) * 255);
  const g = Math.round((gPrime + m) * 255);
  const b = Math.round((bPrime + m) * 255);

  return `${r},${g},${b}`;
}

export function resolveCommunityPalette(name: string): CommunityPalette {
  const normalizedName = name || "Community";
  const manual = TEAM_COLOR_RULES.find((rule) => rule.pattern.test(normalizedName));

  if (manual) {
    return {
      primaryRgb: manual.primaryRgb,
      secondaryRgb: manual.secondaryRgb,
      primaryLabel: manual.primaryLabel || "Primary",
      secondaryLabel: manual.secondaryLabel || "Secondary",
      source: "manual",
    };
  }

  return {
    primaryRgb: hslToRgbString(stringHue(normalizedName, 190), 78, 52),
    secondaryRgb: hslToRgbString(stringHue(normalizedName, 238), 72, 48),
    primaryLabel: "Primary",
    secondaryLabel: "Secondary",
    source: "generated",
  };
}

export function createCommunityBannerStyle(palette: CommunityPalette): CSSProperties {
  const primary = palette.primaryRgb;
  const secondary = palette.secondaryRgb;

  return {
    backgroundColor: "rgba(2, 6, 23, 0.92)",
    backgroundImage: `linear-gradient(118deg, rgba(${primary}, 0.22) 0%, rgba(${secondary}, 0.20) 42%, rgba(2,6,23,0.16) 82%), radial-gradient(72% 145% at 0% 48%, rgba(${primary}, 0.50), transparent 69%), radial-gradient(72% 145% at 100% 30%, rgba(${secondary}, 0.44), transparent 71%), repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 15px, rgba(255,255,255,0) 15px 33px)`,
    backgroundBlendMode: "screen, normal, normal, soft-light",
  };
}

export function createCommunityBannerLightOverlayStyle(palette: CommunityPalette): CSSProperties {
  const primary = palette.primaryRgb;
  const secondary = palette.secondaryRgb;

  return {
    backgroundImage: `linear-gradient(118deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.16) 42%, rgba(255,255,255,0.10) 100%), radial-gradient(84% 156% at 0% 42%, rgba(${primary}, 0.48), transparent 70%), radial-gradient(84% 156% at 100% 30%, rgba(${secondary}, 0.42), transparent 72%), linear-gradient(126deg, rgba(${primary}, 0.22) 0%, rgba(${secondary}, 0.18) 100%), repeating-linear-gradient(135deg, rgba(255,255,255,0.10) 0 14px, rgba(255,255,255,0.02) 14px 30px)`,
    backgroundBlendMode: "screen, normal, normal, normal, soft-light",
  };
}

export function createTeamCommunityCardBackground(name: string): CSSProperties {
  const { primaryRgb, secondaryRgb } = resolveCommunityPalette(name);
  return {
    backgroundColor: "rgba(2,6,23,0.92)",
    backgroundImage: `linear-gradient(118deg, rgba(${primaryRgb}, 0.72) 0%, rgba(${primaryRgb}, 0.62) 44%, rgba(${secondaryRgb}, 0.34) 76%, rgba(2,6,23,0.88) 100%), radial-gradient(128% 150% at 6% 8%, rgba(${primaryRgb}, 0.44), transparent 66%), radial-gradient(112% 136% at 96% 18%, rgba(${secondaryRgb}, 0.2), transparent 72%), repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 14px, rgba(255,255,255,0) 14px 30px)`,
  };
}

export function createTeamCommunityCardLightOverlay(name: string): CSSProperties {
  const { primaryRgb, secondaryRgb } = resolveCommunityPalette(name);
  return {
    backgroundImage: `linear-gradient(118deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.08) 42%, rgba(255,255,255,0.04) 100%), radial-gradient(88% 160% at 0% 38%, rgba(${primaryRgb}, 0.52), transparent 70%), radial-gradient(88% 160% at 100% 32%, rgba(${secondaryRgb}, 0.44), transparent 72%), linear-gradient(126deg, rgba(${primaryRgb}, 0.20) 0%, rgba(${secondaryRgb}, 0.17) 100%), repeating-linear-gradient(135deg, rgba(255,255,255,0.10) 0 14px, rgba(255,255,255,0.02) 14px 30px)`,
    backgroundBlendMode: "screen, normal, normal, normal, soft-light",
  };
}

export function createGeneralCommunityCardBackground(): CSSProperties {
  return {
    backgroundColor: "rgba(2,6,23,0.94)",
    backgroundImage:
      "linear-gradient(116deg, rgba(14,165,233,0.62) 0%, rgba(56,189,248,0.50) 38%, rgba(34,197,94,0.38) 72%, rgba(2,6,23,0.86) 100%), radial-gradient(110% 160% at 0% 34%, rgba(14,165,233,0.42), transparent 68%), radial-gradient(96% 150% at 100% 30%, rgba(34,197,94,0.26), transparent 72%), repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 14px, rgba(255,255,255,0) 14px 30px)",
  };
}

export function createGeneralCommunityCardLightOverlay(): CSSProperties {
  return {
    backgroundImage:
      "linear-gradient(118deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.10) 42%, rgba(255,255,255,0.05) 100%), radial-gradient(90% 160% at 0% 36%, rgba(14,165,233,0.34), transparent 70%), radial-gradient(90% 150% at 100% 30%, rgba(34,197,94,0.26), transparent 72%), linear-gradient(126deg, rgba(14,165,233,0.16) 0%, rgba(34,197,94,0.14) 100%), repeating-linear-gradient(135deg, rgba(255,255,255,0.10) 0 14px, rgba(255,255,255,0.02) 14px 30px)",
    backgroundBlendMode: "screen, normal, normal, normal, soft-light",
  };
}
