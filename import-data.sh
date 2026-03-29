#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
SEASON="${1:-}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to import provider data." >&2
  exit 1
fi

docker compose up -d db seeder app nginx

for attempt in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/" >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "Timed out waiting for SportsDeck at ${BASE_URL}" >&2
    exit 1
  fi

  sleep 2
done

matches_url="${BASE_URL}/api/sync/matches"
standings_url="${BASE_URL}/api/sync/standings"

if [ -n "$SEASON" ]; then
  matches_url="${matches_url}?season=${SEASON}"
  standings_url="${standings_url}?season=${SEASON}"
fi

curl -fsS -X POST "${BASE_URL}/api/sync/teams"
echo
curl -fsS -X POST "$matches_url"
echo
curl -fsS -X POST "$standings_url"
echo

docker compose run --rm seeder npx tsx prisma/seed.ts
