function toDbSeasonLabel(startYear: number): string {
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

export function normalizeSeasonFilter(rawSeason: string | null | undefined) {
  if (!rawSeason) {
    return { ok: true, dbSeason: null, providerSeason: null, input: null };
  }

  const input = String(rawSeason).trim();

  if (/^\d{4}$/.test(input)) {
    const startYear = Number(input);
    return { ok: true, dbSeason: toDbSeasonLabel(startYear), providerSeason: input, input };
  }

  const match = input.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    return { ok: true, dbSeason: input, providerSeason: match[1], input };
  }

  return { ok: false, error: "season must be YYYY or YYYY-YY", dbSeason: null, providerSeason: null, input };
}