# Architecture

The browser calls same-origin tRPC through `packages/client`. Hono constructs services, the Notion request queue, authentication and storage adapters at startup. Runtime environment is parsed and validated only in `apps/api/src/env.ts`; the entrypoint starts optional telemetry before loading the server.

Notion is the source of truth for configured shopping records, documents and feedback. Complete paginated reads are validated before atomically replacing ignored JSON projections. Failed refreshes preserve the last good copy and expose stale/error state. Without a token, the application can read synthetic local projections while reporting an offline/unconfigured state. Collection and visual-reference imports have their own provenance and import date.

The owner may update only the purchase state of an existing shopping item in the configured source. Shared accounts may read and add feedback. Opaque server-side sessions, password hashes, origin checks and CSRF tokens protect the HTTP boundary. Display author labels are never authorization. Private APIs and media require authentication; static frontend assets contain no runtime data.

Media is served through validated local paths. Signed upstream download URLs and private import files stay server-side. Feedback submissions use a durable operation journal to avoid blindly repeating an uncertain remote create. Keep that journal across production restarts and rollbacks.

Transport stays in the apps, domain services in `packages/backend`, and browser requests in query hooks. Zod schemas define external boundaries. Tests cover pagination, stale caches, import validation, auth/CSRF/role behavior, HTTP mutations, offline states and keyboard-accessible UI behavior.
