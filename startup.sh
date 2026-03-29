#!/bin/bash
set -euo pipefail

npm install
npx prisma generate
npx prisma migrate deploy
npx tsx prisma/seed.ts
