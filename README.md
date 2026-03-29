# SportsDeck

SportsDeck is a production-mode Next.js app backed by PostgreSQL, Redis, Prisma, and Nginx. The repo includes Docker configuration for the full stack so it can run in a fresh environment.

## Containers

The Docker setup includes:

- `db` for PostgreSQL
- `redis` for standalone cache storage
- `seeder` for `prisma migrate deploy` and `prisma/seed.ts`
- `app` for the production Next.js server
- `nginx` as the reverse proxy on port `80`

## Required environment variables

Create a `.env` file with values for:

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

Inside Docker Compose, the app container is automatically pointed at:

```env
DATABASE_URL="postgresql://postgres:postgres@db:5432/sportsdeck"
REDIS_URL="redis://redis:6379"
```

## Run with Docker

Build and start everything with:

```bash
docker compose up --build
```

Then open [http://localhost](http://localhost).

## Notes

- The Next.js app is built during the Docker build phase with `npm run build`.
- The production container serves the standalone build output.
- PostgreSQL uses a named volume for persistent database storage.
- Redis uses a named volume for standalone cache persistence.
- Nginx forwards incoming traffic to the Next.js app container.
