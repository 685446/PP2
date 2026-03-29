# SportsDeck

SportsDeck is a football discussion platform built with Next.js, React, Tailwind CSS, Prisma, PostgreSQL, Redis, and Nginx. Users can follow teams and people, join match and community discussions, vote in polls, view AI-powered sentiment and translation features, and use moderation/reporting tools.

## Features

- account creation and authentication
- live football match, team, and standings data
- discussion threads, replies, nested replies, and polls
- social features including profiles, followers, and following
- moderation flows including reports, suspensions, bans, and appeals
- AI-powered translation, sentiment indicators, and digest features
- production Docker deployment with PostgreSQL, Redis, and Nginx

## Deployment

- Public deployment URL: add the final deployed URL to `url.txt`
- Local production run: use Docker Compose with the included scripts

## Stack

- Next.js + React + TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- Redis
- Nginx
- Hugging Face Inference API
- football-data.org API

## Run Locally With Docker

The project is designed to run in production mode through Docker Compose.

### Included services

- `app` - production Next.js server
- `db` - PostgreSQL
- `redis` - standalone cache server
- `seeder` - runs `prisma migrate deploy` and `prisma/seed.ts`
- `nginx` - reverse proxy

### Required environment variables

Create a `.env` file and provide values for:

- `DATABASE_URL`
- `REDIS_URL`
- `SPORTS_API_BASE_URL`
- `SPORTS_API_KEY`
- `SPORTS_LEAGUE_CODE`
- `HUGGINGFACE_API_KEY`
- `BCRYPT_SALT_ROUNDS`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_EXPIRES_IN`
- `JWT_EXPIRES_IN_SECONDS`
- `JWT_REFRESH_EXPIRES_IN`
- `SYSTEM_USER_EMAIL`
- `SYSTEM_USER_USERNAME`
- `SYSTEM_USER_AVATAR`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`

For local Docker use, the host-facing values should look like:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sportsdeck"
REDIS_URL="redis://localhost:6379"
```

Inside Docker Compose, the app automatically talks to:

```env
DATABASE_URL="postgresql://postgres:postgres@db:5432/sportsdeck"
REDIS_URL="redis://redis:6379"
```

### Start the app

```bash
./start.sh
```

Or run Docker Compose directly:

```bash
docker compose up --build
```

### Stop the app

```bash
./stop.sh
```

### Import or refresh sports data

```bash
./import-data.sh
```

### Local URLs

- `http://localhost:3000` - direct Next.js app
- `http://localhost` - app through Nginx

## Build Notes

- The Next.js app is built during the Docker build phase with `npm run build`.
- The production container serves the standalone Next.js output.
- PostgreSQL uses a named volume for persistence.
- Redis uses a named volume for cache persistence.
- Nginx forwards incoming traffic to the app container.

## Seeded Demo Data

The seed script populates the app with substantial demo content, including:

- around 100 users with different join dates and favorite teams
- suspended and banned users
- appeals and user reports
- 200+ discussion and team threads
- generated posts, replies, nested replies, and edited comments
- multilingual comments
- seeded polls with votes
- follow relationships between users

## Credits

- Match and standings data: [football-data.org](https://www.football-data.org/)
- AI translation and analysis: [Hugging Face Inference API](https://huggingface.co/)
- Default avatar icons: [Freepik](https://www.freepik.com/)
