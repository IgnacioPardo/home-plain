# Home Plain

A home-planning app with a catalog, shopping checklist, room views, visual references, documents and notes. Spanish UI, light/dark themes and mobile layouts. Built with React, TanStack Router/Query, Hono, tRPC, Zod, PostgreSQL and Drizzle in a pnpm workspace.

The repository contains application code and synthetic examples. It has fresh Git history, generic accounts, no imported personal photos or records, and no automatic deployment. PostgreSQL owns application data; no Notion integration or token is required.

## Run the local demo

Requires Node **22.12+**, pnpm **10.33.3** and Docker (or a PostgreSQL server).

```sh
pnpm install --frozen-lockfile
pnpm demo:setup
docker compose -f compose.database.yml up -d --wait
pnpm db:migrate
pnpm demo:seed
pnpm dev
```

Open **http://localhost:5173**. Find the generated passwords in ignored `data/demo-access.txt`: `home` is the shared account and `owner` is the owner. Setup creates separate random account credentials and a database password in owner-readable files. It refuses to overwrite an existing `.env` or `data/` directory. Migrations create tables; the repeatable seed creates the household/accounts and imports four clearly synthetic records. Purchase toggles and feedback work immediately and survive API restarts.

Example links use `example.com` and are illustrative. No actual product photos, prices, ownership claims or personal decisions are included. The API listens on `127.0.0.1:3000`; the website proxies requests to it. Use coordinated alternative ports for another checkout. `docker compose -f compose.database.yml stop` preserves the database volume.

Optional: configure the [planning agent](docs/agent-runtime.md) to prepare a room plan from existing purchases. It saves a proposal for review; accepting it creates a note. Without model credentials, the UI reports that the agent is unconfigured.

For frontend-only synthetic states, run `pnpm dev:web` and open `/stories.html`. This development page is excluded from production.

## Use your own data

Follow [configuration](docs/configuration.md). Runtime records belong in PostgreSQL; private import bundles and media belong in ignored `data/`. Keep credentials in ignored `.env` or your host secret store, never frontend code or a `VITE_` variable.

Authentication is required even locally. Shared accounts can read and add feedback; only owners can change purchases. Each account currently belongs to one household. Every API read/write uses the household from the authenticated session. Display labels (`Persona A`, `Persona B`) do not grant permissions. Signup, invitations and multiple households per account are not implemented.

## Validate

Provide `TEST_DATABASE_URL` in the shell or ignored `.env.test`. It must point to a **disposable database named `home_plain_test`**, with permission to create schemas. Tests create and remove their own random schemas; they fail if PostgreSQL is unavailable.

```sh
pnpm privacy:check
pnpm ready
```

`ready` runs typechecking, tests and production builds. Integration tests exercise committed SQL migrations, repeated imports, independent database pools, conflicting purchase versions, durable feedback retries, authentication and household isolation against real PostgreSQL. GitHub Actions supplies PostgreSQL and also validates demo setup/migration/seeding. It never deploys.

The public-source guard rejects runtime data, unreviewed media, credential-shaped literals, personal paths and non-synthetic identifiers. Review new content, history and screenshots before publishing.

## Structure

| Path | Purpose |
| --- | --- |
| `apps/website` | Browser UI and domain query hooks |
| `apps/api` | HTTP, authentication, environment, startup and database CLI |
| `packages/backend` | Domain services, Drizzle schema, SQL migrations and validated imports |
| `packages/client` | Browser-safe typed transport |
| `packages/logger`, `packages/telemetry`, `packages/utils` | Shared infrastructure |
| `examples` | Synthetic records only |
| `scripts` | Demo setup, test runner and public-source guard |

See [architecture](docs/architecture.md) and [publication notes](docs/publication.md).

## Attribution

The application structure is based on [sponja23/fullstack-template](https://github.com/sponja23/fullstack-template), revision `fb1ecdd491165e356e5754979253758531b87de1`. This repository does not declare a code license; public visibility alone does not grant an open-source license. Dependencies retain their own licenses. No third-party photography is redistributed here.
