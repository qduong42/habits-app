# Build context is the REPO ROOT (see docker-compose.yml: build.context: .),
# because the npm workspaces (root package-lock.json) span server + web.

# ---- Stage 1: build server (tsc) + web (vite) ------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install the full workspace tree (incl. devDeps — tsc, vite) with a stable
# layer: manifests only first, sources after.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY server/ server/
COPY web/ web/
RUN npm run build -w server && npm run build -w web

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Production deps for the server workspace only. web/package.json must still
# be present: npm ci reads every workspace manifest to validate the lockfile.
# --ignore-scripts is safe (all server deps are pure JS, no native builds).
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force

# Layout must mirror the repo:
# - server/src/app.ts resolves WEB_DIST as <module dir>/../../web/dist; the
#   compiled module lives at /app/server/dist/app.js → /app/web/dist.
# - server/src/db/migrate.ts resolves migrations CWD-RELATIVE ('./drizzle'),
#   so WORKDIR is /app/server and the SQL journal is copied there.
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY server/drizzle server/drizzle

WORKDIR /app/server
EXPOSE 3001

# Migrate, then seed (idempotent: users/categories/achievements upserts),
# then exec the server so node is PID 1 and receives signals.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && exec node dist/index.js"]
