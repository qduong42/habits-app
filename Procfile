# Heroku process types (Node buildpack; the Docker/Tailscale deploy ignores this).
# Migrations + idempotent seed run in the release phase — compiled output only,
# because devDependencies (tsx) are pruned from the slug. CWD must be server/:
# migrate.ts resolves its ./drizzle journal relative to the working directory.
release: cd server && node dist/db/migrate.js && node dist/db/seed.js
web: cd server && node dist/index.js
