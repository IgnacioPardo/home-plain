import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    AgentRunStore,
    runAgentOnce,
    PlannerError,
    importHome,
    type AgentProposal,
} from "@repo/backend";
import { databaseFixture, homeId, itemId, origin } from "./database.fixture.ts";
import { createApp } from "./app.ts";
import { AuthenticationService } from "./auth/auth.service.ts";
import { testPasswords, verifyTestPassword } from "./auth/test-fixture.ts";
import { createOpenAIPlanner } from "./agent-provider.ts";

let f: Awaited<ReturnType<typeof databaseFixture>>;
let store: AgentRunStore;
beforeEach(async () => {
    f = await databaseFixture();
    store = new AgentRunStore(f.db, origin, true);
});
afterEach(async () => {
    await f?.close();
});
const input = () => ({
    operationId: randomUUID(),
    room: "Living",
    goal: "Preparar este ambiente para la mudanza",
});
const proposal: AgentProposal = {
    summary: "Plan de prueba explícito, sin modelo real.",
    steps: [
        { title: "Medir", detail: "Medir los muebles antes de trasladarlos.", evidenceIds: [] },
    ],
};

it("persists queued work and frozen household context across connection replacement, then stores a proposal", async () => {
    const shopping = JSON.parse(
        await readFile(new URL("../../../examples/shopping.json", import.meta.url), "utf8"),
    );
    await importHome(f.db, homeId, { shopping });
    const run = await store.start(f.owner, input());
    await f.disconnect();
    const replacement = new AgentRunStore(f.open().db, origin, true);
    const plan = vi.fn(async (_context: unknown, _signal: AbortSignal) => proposal);
    expect(await runAgentOnce(replacement, { plan })).toBe(true);
    const context = plan.mock.calls[0]![0];
    expect(context).toBeDefined();
    expect(await replacement.get(f.owner, run.id)).toMatchObject({
        status: "succeeded",
        progress: "review",
        attempts: 1,
        proposal,
        decision: "pending",
    });
    expect((await replacement.get(f.owner, run.id)).sources.map((source) => source.id)).toContain(
        itemId,
    );
    expect((await new AgentRunStore(f.open().db, origin, true).list(f.other)).runs).toEqual([]);
    expect(
        (await f.open().db.$client.query("SELECT count(*)::int AS count FROM feedback")).rows[0]
            .count,
    ).toBe(0);
});

it("allows one worker to claim a run, reclaims expired work and fences late results", async () => {
    const run = await store.start(f.owner, input());
    const second = new AgentRunStore(f.open().db, origin, true);
    const claims = await Promise.all([store.claim(), second.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    await f.db.$client.query(
        "UPDATE agent_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
        [run.id],
    );
    expect(await store.heartbeat(old)).toBe(false);
    const resumed = await second.claim();
    expect(resumed?.token).not.toBe(old.token);
    expect(await store.complete(old, proposal)).toBe(false);
    expect(await second.complete(resumed!, proposal)).toBe(true);
    expect((await store.get(f.owner, run.id)).attempts).toBe(2);
});

it("recovers a publication outage without marking valid output as a provider failure", async () => {
    const run = await store.start(f.owner, input());
    const publication = vi
        .spyOn(store, "complete")
        .mockRejectedValueOnce(new Error("Simulated database disconnect"));
    await expect(runAgentOnce(store, { plan: async () => proposal })).rejects.toThrow(
        "Simulated database disconnect",
    );
    expect(await store.get(f.owner, run.id)).toMatchObject({
        status: "running",
        attempts: 1,
        issue: null,
        proposal: null,
    });
    publication.mockRestore();
    await f.db.$client.query(
        "UPDATE agent_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
        [run.id],
    );
    const replacement = new AgentRunStore(f.open().db, origin, true);
    await runAgentOnce(replacement, { plan: async () => proposal });
    expect(await replacement.get(f.owner, run.id)).toMatchObject({
        status: "succeeded",
        attempts: 2,
        issue: null,
        proposal,
    });
});

it("cancels queued and running jobs durably and never publishes after cancellation", async () => {
    const queued = await store.start(f.owner, input());
    await store.cancel(f.owner, queued.id);
    expect(await store.claim()).toBeNull();
    const running = await store.start(f.owner, input());
    const claim = await store.claim();
    expect((await store.cancel(f.owner, running.id)).status).toBe("canceled");
    expect(await store.complete(claim!, proposal)).toBe(false);
    expect(await store.heartbeat(claim!)).toBe(false);
    expect((await store.get(f.owner, running.id)).proposal).toBeNull();
});

it("bounds provider retries, rejects invalid output and does not persist raw errors", async () => {
    const run = await store.start(f.owner, input());
    const broken = {
        plan: async () => {
            throw new PlannerError(true);
        },
    };
    for (let i = 0; i < 3; i++) {
        await f.db.$client.query(
            "UPDATE agent_runs SET available_at=now()-interval '1 second' WHERE id=$1",
            [run.id],
        );
        await runAgentOnce(store, broken);
        if (i < 2) expect(await store.claim()).toBeNull();
    }
    expect(await runAgentOnce(store, broken)).toBe(false);
    expect(await store.get(f.owner, run.id)).toMatchObject({
        status: "failed",
        attempts: 3,
        issue: "provider_failed",
    });
    const invalid = await store.start(f.owner, input());
    await runAgentOnce(store, {
        plan: async () => ({
            ...proposal,
            steps: [{ ...proposal.steps[0], evidenceIds: [randomUUID()] }],
        }),
    });
    expect(await store.get(f.owner, invalid.id)).toMatchObject({
        status: "failed",
        proposal: null,
        attempts: 1,
    });
    const exhausted = await store.start(f.owner, input());
    await f.db.$client.query(
        "UPDATE agent_runs SET status='running', progress='planning', attempts=3, lease_token=$1, lease_expires_at=now()-interval '1 second' WHERE id=$2",
        [randomUUID(), exhausted.id],
    );
    expect(await store.claim()).toBeNull();
    expect(await store.get(f.owner, exhausted.id)).toMatchObject({
        status: "failed",
        issue: "attempts_exhausted",
    });
});

it("deduplicates starts and enforces persisted household limits", async () => {
    const request = input();
    const [first, retry] = await Promise.all([
        store.start(f.owner, request),
        store.start(f.owner, request),
    ]);
    expect(first.id).toBe(retry.id);
    await expect(
        store.start(f.owner, { ...request, goal: "A different goal entirely" }),
    ).rejects.toMatchObject({ reason: "conflict" });
    await store.start(f.owner, input());
    await store.start(f.owner, input());
    await expect(store.start(f.owner, input())).rejects.toMatchObject({ reason: "limit" });
    await store.cancel(f.owner, first.id);
    expect(await store.start(f.owner, input())).toMatchObject({ status: "queued" });
});

it("requires owner review and applies a completed proposal as exactly one note, even under concurrent retries", async () => {
    const run = await store.start(f.owner, input());
    await runAgentOnce(store, { plan: async () => proposal });
    const second = new AgentRunStore(f.open().db, origin, true);
    const [first, retry] = await Promise.all([
        store.decide(f.owner, run.id, "applied"),
        second.decide(f.owner, run.id, "applied"),
    ]);
    expect(first.noteId).toBe(retry.noteId);
    expect((await f.store.listFeedback(f.shared, null)).snapshot?.entries).toHaveLength(1);
    await expect(store.decide(f.owner, run.id, "dismissed")).rejects.toMatchObject({
        reason: "conflict",
    });
    const dismissed = await store.start(f.owner, input());
    await runAgentOnce(store, { plan: async () => proposal });
    await store.decide(f.owner, dismissed.id, "dismissed");
    await expect(store.decide(f.owner, dismissed.id, "applied")).rejects.toMatchObject({
        reason: "conflict",
    });
    expect((await f.store.listFeedback(f.shared, null)).snapshot?.entries).toHaveLength(1);
});

it("isolates run reads and mutations and rechecks revoked owner access before publishing", async () => {
    const run = await store.start(f.owner, input());
    await expect(store.get(f.other, run.id)).rejects.toMatchObject({ reason: "not_found" });
    await expect(store.cancel(f.other, run.id)).rejects.toMatchObject({ reason: "not_found" });
    await expect(store.decide(f.other, run.id, "applied")).rejects.toMatchObject({
        reason: "not_found",
    });
    await expect(store.start({ ...f.shared, role: "owner" }, input())).rejects.toMatchObject({
        reason: "forbidden",
    });
    const claim = await store.claim();
    await f.db.$client.query("UPDATE memberships SET role='commenter' WHERE user_id=$1", [
        f.owner.userId,
    ]);
    expect(await store.complete(claim!, proposal)).toBe(false);
    expect(await store.get(f.shared, run.id)).toMatchObject({
        status: "canceled",
        proposal: null,
        issue: "access_revoked",
    });
    await expect(store.decide(f.owner, run.id, "applied")).rejects.toMatchObject({
        reason: "forbidden",
    });
});

it("protects agent HTTP endpoints with login, owner role, origin and CSRF, and exposes no lease or private identity", async () => {
    const auth = new AuthenticationService(f.store, Date.now, verifyTestPassword);
    const app = createApp(f.store, origin, auth, undefined, store);
    const login = await auth.login("owner", testPasswords.owner);
    if (login.status !== "ok") throw new Error("Test login failed");
    const headers = {
        Origin: origin,
        Cookie: `__Host-home-session=${login.token}`,
        "x-csrf-token": login.session.csrfToken,
        "Content-Type": "application/json",
    };
    const post = (extra: Record<string, string>, body = input()) =>
        app.request(`${origin}/trpc/agent.start`, {
            method: "POST",
            headers: extra,
            body: JSON.stringify({ json: body }),
        });
    expect((await post({ Origin: origin })).status).toBe(401);
    expect((await post({ ...headers, "x-csrf-token": "bad" })).status).toBe(403);
    expect((await post({ ...headers, Origin: "https://other.example" })).status).toBe(403);
    const started = await post(headers);
    expect(started.status).toBe(200);
    const body = await started.text();
    expect(body).not.toMatch(/householdId|leaseToken|fingerprint|userId|passwordHash/);
    const shared = await auth.login("home", testPasswords.home);
    if (shared.status !== "ok") throw new Error("Test login failed");
    expect(
        (
            await post({
                ...headers,
                Cookie: `__Host-home-session=${shared.token}`,
                "x-csrf-token": shared.session.csrfToken,
                "X-User-Role": "owner",
            })
        ).status,
    ).toBe(403);
    const unconfigured = createApp(
        f.store,
        origin,
        auth,
        undefined,
        new AgentRunStore(f.db, origin, false),
    );
    expect(
        (
            await unconfigured.request(`${origin}/trpc/agent.start`, {
                method: "POST",
                headers,
                body: JSON.stringify({ json: input() }),
            })
        ).status,
    ).toBe(412);
});

it("uses the Responses contract with server-only credentials and rejects refusals/incomplete output", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
            JSON.stringify({
                status: "completed",
                output: [
                    {
                        type: "message",
                        content: [{ type: "output_text", text: JSON.stringify(proposal) }],
                    },
                ],
            }),
        ),
    );
    const planner = createOpenAIPlanner("synthetic-provider-key", "configured-model", request);
    const signal = new AbortController().signal;
    expect(
        await planner.plan({ room: "Living", goal: "Plan de prueba", records: [] }, signal),
    ).toEqual(proposal);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options?.signal).toBe(signal);
    expect(JSON.parse(String(options?.body))).toMatchObject({
        store: false,
        model: "configured-model",
        text: { format: { type: "json_schema", strict: true } },
    });
    for (const response of [
        { status: "incomplete", output: [] },
        { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] },
    ]) {
        request.mockResolvedValueOnce(new Response(JSON.stringify(response)));
        await expect(
            planner.plan({ room: "Living", goal: "Plan de prueba", records: [] }, signal),
        ).rejects.toMatchObject({ retryable: false });
    }
    request.mockResolvedValueOnce(new Response("upstream body must not leak", { status: 429 }));
    await expect(
        planner.plan({ room: "Living", goal: "Plan de prueba", records: [] }, signal),
    ).rejects.toMatchObject({
        retryable: true,
        message: "Planning provider could not complete the request",
    });
});

it("retries interrupted provider downloads but rejects malformed completed bodies", async () => {
    const interrupted = new ReadableStream({
        start(controller) {
            controller.error(new Error("Simulated transport disconnect"));
        },
    });
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(interrupted))
        .mockResolvedValueOnce(new Response("invalid JSON"));
    const planner = createOpenAIPlanner("synthetic-provider-key", "configured-model", request);
    const context = { room: "Living", goal: "Plan de prueba", records: [] };
    const signal = new AbortController().signal;
    await expect(planner.plan(context, signal)).rejects.toMatchObject({
        retryable: true,
        message: "Planning provider could not complete the request",
    });
    await expect(planner.plan(context, signal)).rejects.toMatchObject({ retryable: false });
});

it("enforces active limits across day boundaries and a rolling daily request budget", async () => {
    const old = await store.start(f.owner, input());
    await f.db.$client.query(
        "UPDATE agent_runs SET created_at=now()-interval '2 days' WHERE id=$1",
        [old.id],
    );
    await store.start(f.owner, input());
    await store.start(f.owner, input());
    await expect(store.start(f.owner, input())).rejects.toMatchObject({ reason: "limit" });
    for (const run of (await store.list(f.owner)).runs) await store.cancel(f.owner, run.id);
    for (let i = 0; i < 18; i++) {
        const run = await store.start(f.owner, input());
        await store.cancel(f.owner, run.id);
    }
    await expect(store.start(f.owner, input())).rejects.toMatchObject({ reason: "limit" });
    expect(await store.start(f.other, input())).toMatchObject({ status: "queued" });
});
