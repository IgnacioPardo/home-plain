# Configuration

For a synthetic local demo, follow the README. For an empty installation, copy `.env.example` to ignored `.env`, set a PostgreSQL `DATABASE_URL`, and generate two separate password hashes using the command in `.env.example`. Keep each hash in single quotes. Use a dedicated database and a random password; the supplied Compose setup expects URL-safe credentials (the demo generates hexadecimal passwords).

## Database and accounts

Run `pnpm db:migrate`, then `pnpm db:bootstrap`. `HOUSEHOLD_ID`, `HOUSEHOLD_NAME` and the two `AUTH_*` accounts are used only by explicit bootstrap/seed commands. Runtime reads accounts and memberships from PostgreSQL. Repeating bootstrap with identical input is safe; it refuses to reset credentials, change roles or move an existing username to another household. After initialization the API needs `DATABASE_URL`, origin/network settings and a media directory, not bootstrap password hashes.

An operator can bootstrap another household with a different UUID and distinct usernames. Each user currently has one membership; signup, invitations and switching households are not available. For credential rotation or revocation, use a deliberate administrative database change and preserve at least one owner. Existing sessions recheck the account on each request. Never put passwords or hashes into Git or shell history.

## Import existing records

Place a private bundle under ignored `data/`. It can contain `shopping`, `collection`, `content`, `moodboard` and/or `feedback`, each in the validated format defined by the backend schemas. The synthetic examples show the shopping and collection shapes. Older shopping snapshots without a record version start at zero. UUIDs, quantities, nullable prices, attribution URLs and content are preserved.

```sh
pnpm db:import ../../data/import-bundle.json
```

The path is relative to the API workspace because the root command invokes its CLI. The destination is `HOUSEHOLD_ID` from `.env`. Bootstrap configuration must match the existing accounts. A bundle is validated and imported in one transaction; repeating it adds only absent keys and never overwrites current rows. Back up before importing, confirm counts, then verify the UI. There is no background sync, remote write, or network import. Source links in old documents remain usable as attribution.

Copy only images you intend to use into ignored `data/media`. The default `HOME_MEDIA_DIRECTORY` is relative to the API workspace. Imported catalog/moodboard records must reference their `/media/...` filename. The route requires authentication and a reference belonging to the same household. Keep signed remote URLs, raw exports and private images out of Git.

## Local integration tests

Create a separate disposable database named `home_plain_test` on your local PostgreSQL instance. Set `TEST_DATABASE_URL` in ignored `.env.test` (or the shell) to that database. Use a user allowed to create schemas. `pnpm test` requires it: the suite never substitutes an in-memory database or silently skips persistence checks. Only random test schemas are dropped.

## Container hosting

`Dockerfile` and `docker-compose.yml` provide an optional API/frontend container plus a private PostgreSQL container. They use separate database and media volumes. Set your own `POSTGRES_PASSWORD` and a real HTTPS `APP_ORIGIN`; production rejects a localhost HTTP origin. Configure an HTTPS reverse proxy yourself; the API port binds only to loopback and the database has no host port in this Compose file.

```sh
docker compose build home
docker compose up -d --wait database
docker compose run --rm home node dist/database.js migrate
docker compose run --rm home node dist/database.js bootstrap
docker compose up -d home
```

Keep backups of both PostgreSQL and media, and verify restoration separately. Never use `down -v` unless you intend to erase the database. Container bootstrap uses the account hashes from ignored `.env`; they can be removed after initialization. The synthetic seed command is for the source checkout. For a container import, mount a private bundle under `/app/data` and pass that absolute path to `node dist/database.js import`.

No DNS, tunnel credentials, external hosting, self-hosted runner or deployment automation is supplied. Sessions live in one API process and expire on restart; multiple replicas require shared sessions and throttling. Business data survives restarts in PostgreSQL.

## Optional planning agent

See [agent runtime](agent-runtime.md) for `OPENAI_API_KEY`/`AGENT_MODEL`, data sent to the provider, usage limits, recovery and review behavior. Leave both empty to run the application without model calls.
