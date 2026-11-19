# Planning agent runtime

This first workflow prepares a room plan from a user's goal and up to 50 existing purchases in that room. It produces a proposal with references to those records. It does not research the web, infer current prices, buy products, contact people or edit existing purchases. The owner can save an approved proposal as a note labeled `Agente`, or dismiss it. Generating a proposal never creates a note automatically.

## Configuration and use

Apply committed migrations with `pnpm db:migrate`. To enable model calls, configure both `OPENAI_API_KEY` and `AGENT_MODEL` in ignored `.env` or your server secret store, then restart the API. Choose a model that supports structured outputs in the Responses API. There is no default model, credential or automatic fallback. Leaving both variables empty keeps previous runs readable while disabling new requests and the worker. Configure provider spending limits for your account as appropriate.

Open **Notas → Planificar con un agente**. Before submission the form explains that the goal and selected room records are sent to OpenAI. Credentials remain in the API process. The request uses the official Responses endpoint, `store: false`, a strict JSON schema and an output-token limit. Raw provider errors and responses are never logged or saved. An incomplete or refused response produces a failed run, not invented success.

The implementation follows the official [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create) and [structured output guide](https://developers.openai.com/api/docs/guides/structured-outputs). This repository's automated checks verify that request/response contract with an explicitly fake provider; they do not claim a live model invocation. No provider credentials are present in the repository or CI.

## Persistence and recovery

`agent_runs` stores the request identifier, authenticated requester/household, a frozen context, status, attempt count, progress, lease, result and review decision in PostgreSQL. API responses strip internal identities, fingerprints and worker tokens. The list is bounded to the 30 most recent runs; individual runs remain addressable by ID.

A transaction locks the household to deduplicate submissions and enforce limits: three active runs and 20 new runs in a rolling 24-hour period per household. Retrying the same operation identifier and payload returns the original run. Reusing an identifier for another payload or requester is rejected.

Workers claim eligible rows with `FOR UPDATE SKIP LOCKED`. A lease lasts 120 seconds and is renewed every ten seconds. The provider call has a 60-second deadline. A replacement worker can reclaim expired work; the old token can no longer update or publish it. Provider failures that may be transient retry at most three times, with a persisted five-second-per-attempt delay. Invalid model output fails immediately. Repeated process crashes also stop after three attempts. Execution is **at least once**: a crash may repeat a model call and incur provider cost, while database fencing prevents duplicate publication.

Canceling clears the lease and prevents result publication immediately. A running call receives abort on the next heartbeat, within approximately ten seconds while the database is available. Cancellation cannot undo work already performed or charges already incurred by the provider. Owner membership is checked before claiming and again before publication; revoked access cancels the result.

Accepting a proposal locks its run, creates one note and records the decision in one transaction. Concurrent or repeated acceptance returns the same note. Dismissed/applied decisions cannot be changed by a retry. The result validates every evidence ID against the captured context; generated text is treated as untrusted and rendered as text. References describe the data at submission time and may no longer reflect later edits.

The API runs one worker loop when configured. Multiple worker processes can coordinate through PostgreSQL; API login sessions and throttling still require one API process as documented in the architecture. Model-key rotation, external research, richer tools, shared API sessions, notifications and editing existing plans are separate work.

## Validation

`pnpm ready` includes real-PostgreSQL tests for connection replacement, competing workers, lease expiry, stale tokens, cancellation, retries, invalid evidence, request quotas, household isolation, revoked roles and exactly-once note acceptance. HTTP tests exercise login, origin, CSRF and owner access. UI tests verify configuration/error states, stable request identifiers after uncertain responses, explicit acceptance and waiting for confirmed cancellation. The provider contract is tested independently with a deterministic test transport.
