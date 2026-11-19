# Home Plain

A home-planning app with a catalog, shopping checklist, room views, visual references, documents and notes. Spanish UI, light/dark themes and mobile layouts. Built with React, TanStack Router/Query, Hono, tRPC, Zod and Vite+ in a pnpm workspace.

The repository contains application code and synthetic examples. It has fresh Git history, generic accounts, no imported photos or personal records, and no automatic deployment. Notion is optional for exploring the demo.

## Run the local demo

Requires Node **22.12+** and pnpm **10.33.3**.

```sh
pnpm install --frozen-lockfile
pnpm demo:setup
pnpm dev
```

Open **http://localhost:5173**. Find the generated passwords in `data/demo-access.txt`: `home` is the shared account and `owner` is the owner. Setup generates separate random credentials, saves their hashes in `.env`, and installs four clearly synthetic example records. It refuses to overwrite an existing `.env` or `data/` directory. The files are ignored by Git and readable only by their owner.

The demo runs without a Notion token. Imported examples appear as a local copy; purchase toggles and feedback writes remain disabled until an integration is configured. Example links use `example.com` and are illustrative. No actual product photos, prices, ownership claims or personal decisions are included. The API listens on `127.0.0.1:3000`; the website proxies API requests to it. Use different coordinated ports if another checkout is running.

For frontend-only synthetic states, run `pnpm dev:web` and open `/stories.html`. This development page is excluded from the production entry.

## Use your own data

Follow [configuration](docs/configuration.md). Keep all personal configuration, caches, imports and media under ignored `.env` and `data/`. Never put a token in frontend source or a `VITE_` environment variable. Runtime data is a replaceable projection; Notion owns shopping and feedback records.

Authentication is required even for local development. Shared sessions can read and add feedback; only the owner can change shopping completion. Display names are labels, not permissions. Generic feedback labels are `Persona A` and `Persona B`.

## Validate

```sh
pnpm privacy:check
pnpm ready
```

`ready` runs typechecking, tests and production builds. GitHub Actions runs these checks and validates demo setup on hosted runners. It does not deploy anything. The public-source guard rejects runtime data, unreviewed media, credential-shaped literals, personal local paths and non-synthetic identifiers. It is a guardrail, not a complete secret scanner: review new content and Git history before publishing, and review screenshots visually.

## Structure

| Path | Purpose |
| --- | --- |
| `apps/website` | Browser UI and domain query hooks |
| `apps/api` | HTTP, authentication, environment and service construction |
| `packages/backend` | Notion adapters, schemas, projections and domain services |
| `packages/client` | Browser-safe typed transport |
| `packages/logger`, `packages/telemetry`, `packages/utils` | Shared infrastructure |
| `examples` | Synthetic records only |
| `scripts` | Demo setup, public-source guard and optional imports |

See [architecture](docs/architecture.md) and [publication notes](docs/publication.md).

## Attribution

The application structure is based on [sponja23/fullstack-template](https://github.com/sponja23/fullstack-template), revision `fb1ecdd491165e356e5754979253758531b87de1`. This repository does not declare a code license; public visibility alone does not grant an open-source license. Dependencies retain their own licenses. No third-party photography is redistributed here.
