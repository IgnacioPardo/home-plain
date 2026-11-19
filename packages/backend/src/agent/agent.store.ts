import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { HomeDatabase } from "../database/connection.ts";
import { HomeError, type Identity } from "../database/home.store.ts";
import * as t from "../database/schema.ts";
import {
    agentContextSchema,
    agentProposalSchema,
    agentRunSchema,
    startAgentSchema,
    type AgentContext,
    type AgentProposal,
    type StartAgent,
} from "./agent.schema.ts";

type Transaction = Parameters<Parameters<HomeDatabase["transaction"]>[0]>[0];
type Database = HomeDatabase | Transaction;
type RunRow = typeof t.agentRuns.$inferSelect;
export type AgentClaim = {
    householdId: string;
    id: string;
    userId: string;
    token: string;
    context: AgentContext;
};
export class AgentError extends Error {
    constructor(readonly reason: "unconfigured" | "limit") {
        super(`Agent operation failed (${reason})`);
    }
}
const leaseSeconds = 120;
const maxAttempts = 3;
const unfinished = () =>
    or(
        and(eq(t.agentRuns.status, "queued"), lt(t.agentRuns.availableAt, sql`now()`)),
        and(eq(t.agentRuns.status, "running"), lt(t.agentRuns.leaseExpiresAt, sql`now()`)),
    )!;
export class AgentRunStore {
    constructor(
        readonly db: HomeDatabase,
        private readonly origin: string,
        readonly configured: boolean,
    ) {}

    async list(identity: Identity) {
        await authorize(this.db, identity);
        const rows = await this.db
            .select()
            .from(t.agentRuns)
            .where(eq(t.agentRuns.householdId, identity.householdId))
            .orderBy(desc(t.agentRuns.createdAt), desc(t.agentRuns.id))
            .limit(30);
        return { configured: this.configured, runs: rows.map(runView) };
    }
    async get(identity: Identity, id: string) {
        await authorize(this.db, identity);
        const [row] = await this.db
            .select()
            .from(t.agentRuns)
            .where(runKey(identity.householdId, id));
        if (!row) throw new HomeError("not_found");
        return runView(row);
    }
    async start(identity: Identity, raw: StartAgent) {
        const input = startAgentSchema.parse(raw);
        if (!this.configured) throw new AgentError("unconfigured");
        return this.db.transaction(async (tx) => {
            await authorize(tx, identity, true);
            await tx
                .select()
                .from(t.households)
                .where(eq(t.households.id, identity.householdId))
                .for("update");
            const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
            const [existing] = await tx
                .select()
                .from(t.agentRuns)
                .where(
                    and(
                        eq(t.agentRuns.householdId, identity.householdId),
                        eq(t.agentRuns.operationId, input.operationId),
                    ),
                );
            if (existing) {
                if (existing.userId !== identity.userId || existing.fingerprint !== fingerprint)
                    throw new HomeError("conflict");
                return runView(existing);
            }
            const [counts] = await tx
                .select({
                    total: sql<number>`count(*) FILTER (WHERE created_at > now() - interval '1 day')::int`,
                    active: sql<number>`count(*) FILTER (WHERE status IN ('queued','running'))::int`,
                })
                .from(t.agentRuns)
                .where(eq(t.agentRuns.householdId, identity.householdId));
            if (counts!.total >= 20 || counts!.active >= 3) throw new AgentError("limit");
            const items = await tx
                .select({
                    id: t.shoppingItems.id,
                    name: t.shoppingItems.name,
                    status: t.shoppingItems.status,
                    notes: t.shoppingItems.notes,
                })
                .from(t.shoppingItems)
                .where(
                    and(
                        eq(t.shoppingItems.householdId, identity.householdId),
                        eq(t.shoppingItems.room, input.room),
                    ),
                )
                .orderBy(asc(t.shoppingItems.id))
                .limit(50);
            const context = agentContextSchema.parse({
                room: input.room,
                goal: input.goal,
                records: items.map((item) => ({
                    id: item.id,
                    title: item.name.slice(0, 160),
                    detail: `${item.status}. ${item.notes}`.slice(0, 1000),
                })),
            });
            const [row] = await tx
                .insert(t.agentRuns)
                .values({
                    householdId: identity.householdId,
                    id: randomUUID(),
                    operationId: input.operationId,
                    userId: identity.userId,
                    fingerprint,
                    context,
                })
                .returning();
            return runView(row!);
        });
    }
    async cancel(identity: Identity, id: string) {
        return this.db.transaction(async (tx) => {
            await authorize(tx, identity, true);
            const [row] = await tx
                .select()
                .from(t.agentRuns)
                .where(runKey(identity.householdId, id))
                .for("update");
            if (!row) throw new HomeError("not_found");
            if (row.status === "queued" || row.status === "running") {
                const [canceled] = await tx
                    .update(t.agentRuns)
                    .set({
                        status: "canceled",
                        progress: "canceled",
                        leaseToken: null,
                        leaseExpiresAt: null,
                        updatedAt: new Date(),
                    })
                    .where(runKey(identity.householdId, id))
                    .returning();
                return runView(canceled!);
            }
            return runView(row);
        });
    }
    async decide(identity: Identity, id: string, decision: "applied" | "dismissed") {
        return this.db.transaction(async (tx) => {
            await authorize(tx, identity, true);
            const [row] = await tx
                .select()
                .from(t.agentRuns)
                .where(runKey(identity.householdId, id))
                .for("update");
            if (!row) throw new HomeError("not_found");
            if (row.decision === decision) return runView(row);
            if (row.status !== "succeeded" || !row.proposal || row.decision !== "pending")
                throw new HomeError("conflict");
            let noteId: string | null = null;
            if (decision === "applied") {
                noteId = randomUUID();
                const proposal = agentProposalSchema.parse(row.proposal);
                const body = proposalText(proposal, row.context);
                await tx
                    .insert(t.feedback)
                    .values({
                        householdId: row.householdId,
                        id: noteId,
                        operationId: randomUUID(),
                        userId: identity.userId,
                        fingerprint: "agent-approved",
                        kind: "note",
                        displayAuthor: "Agente",
                        title: `Plan: ${row.context.room}`.slice(0, 160),
                        body,
                        contextUrl: new URL(`/notas#nota-${noteId}`, this.origin).href,
                    });
            }
            const [saved] = await tx
                .update(t.agentRuns)
                .set({ decision, noteId, updatedAt: new Date() })
                .where(runKey(identity.householdId, id))
                .returning();
            return runView(saved!);
        });
    }
    async claim(): Promise<AgentClaim | null> {
        return this.db.transaction(async (tx) => {
            await tx
                .update(t.agentRuns)
                .set({
                    status: "failed",
                    progress: "failed",
                    issue: "attempts_exhausted",
                    leaseToken: null,
                    leaseExpiresAt: null,
                    updatedAt: new Date(),
                })
                .where(and(unfinished(), eq(t.agentRuns.attempts, maxAttempts)));
            const [row] = await tx
                .select()
                .from(t.agentRuns)
                .where(and(unfinished(), lt(t.agentRuns.attempts, maxAttempts)))
                .orderBy(asc(t.agentRuns.createdAt), asc(t.agentRuns.id))
                .limit(1)
                .for("update", { skipLocked: true });
            if (!row) return null;
            if (!(await ownerExists(tx, row))) {
                await tx
                    .update(t.agentRuns)
                    .set({
                        status: "canceled",
                        progress: "canceled",
                        issue: "access_revoked",
                        leaseToken: null,
                        leaseExpiresAt: null,
                        updatedAt: new Date(),
                    })
                    .where(runKey(row.householdId, row.id));
                return null;
            }
            const token = randomUUID();
            await tx
                .update(t.agentRuns)
                .set({
                    status: "running",
                    progress: "planning",
                    attempts: sql`${t.agentRuns.attempts} + 1`,
                    leaseToken: token,
                    leaseExpiresAt: sql`now() + ${leaseSeconds} * interval '1 second'`,
                    updatedAt: new Date(),
                })
                .where(runKey(row.householdId, row.id));
            return {
                id: row.id,
                householdId: row.householdId,
                userId: row.userId,
                token,
                context: agentContextSchema.parse(row.context),
            };
        });
    }
    async heartbeat(claim: AgentClaim) {
        const rows = await this.db
            .update(t.agentRuns)
            .set({
                leaseExpiresAt: sql`now() + ${leaseSeconds} * interval '1 second'`,
                updatedAt: new Date(),
            })
            .where(fence(claim))
            .returning({ id: t.agentRuns.id });
        return rows.length === 1;
    }
    async complete(claim: AgentClaim, raw: unknown) {
        const proposal = agentProposalSchema.parse(raw);
        const evidence = new Set(claim.context.records.map((record) => record.id));
        if (proposal.steps.some((step) => step.evidenceIds.some((id) => !evidence.has(id))))
            throw new Error("Unknown evidence in proposal");
        if (proposalText(proposal, claim.context).length > 8000)
            throw new Error("Proposal exceeds note limit");
        return this.db.transaction(async (tx) => {
            const [row] = await tx.select().from(t.agentRuns).where(fence(claim)).for("update");
            if (!row) return false;
            if (!(await ownerExists(tx, row))) {
                await tx
                    .update(t.agentRuns)
                    .set({
                        status: "canceled",
                        progress: "canceled",
                        issue: "access_revoked",
                        leaseToken: null,
                        leaseExpiresAt: null,
                        updatedAt: new Date(),
                    })
                    .where(runKey(row.householdId, row.id));
                return false;
            }
            await tx
                .update(t.agentRuns)
                .set({
                    status: "succeeded",
                    progress: "review",
                    proposal,
                    issue: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                    updatedAt: new Date(),
                })
                .where(fence(claim));
            return true;
        });
    }
    async fail(claim: AgentClaim, retryable: boolean) {
        await this.db
            .update(t.agentRuns)
            .set({
                status: retryable
                    ? sql`CASE WHEN attempts < ${maxAttempts} THEN 'queued' ELSE 'failed' END`
                    : "failed",
                progress: retryable
                    ? sql`CASE WHEN attempts < ${maxAttempts} THEN 'queued' ELSE 'failed' END`
                    : "failed",
                availableAt: sql`now() + attempts * interval '5 seconds'`,
                issue: "provider_failed",
                leaseToken: null,
                leaseExpiresAt: null,
                updatedAt: new Date(),
            })
            .where(fence(claim));
    }
}
function runKey(householdId: string, id: string) {
    return and(eq(t.agentRuns.householdId, householdId), eq(t.agentRuns.id, id))!;
}
function fence(claim: AgentClaim) {
    return and(
        runKey(claim.householdId, claim.id),
        eq(t.agentRuns.status, "running"),
        eq(t.agentRuns.leaseToken, claim.token),
        gt(t.agentRuns.leaseExpiresAt, sql`now()`),
    )!;
}
async function ownerExists(db: Database, row: Pick<RunRow, "userId" | "householdId">) {
    const [member] = await db
        .select()
        .from(t.memberships)
        .where(
            and(
                eq(t.memberships.userId, row.userId),
                eq(t.memberships.householdId, row.householdId),
                eq(t.memberships.role, "owner"),
            ),
        );
    return Boolean(member);
}
async function authorize(db: Database, identity: Identity, owner = false) {
    const [member] = await db
        .select()
        .from(t.memberships)
        .where(
            and(
                eq(t.memberships.userId, identity.userId),
                eq(t.memberships.householdId, identity.householdId),
            ),
        );
    if (!member || (owner && member.role !== "owner")) throw new HomeError("forbidden");
}
function runView(row: RunRow) {
    return agentRunSchema.parse({
        ...row,
        room: row.context.room,
        goal: row.context.goal,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        sources: row.context.records.map(({ id, title }) => ({ id, title })),
    });
}
function proposalText(proposal: AgentProposal, context: AgentContext) {
    return [
        proposal.summary,
        ...proposal.steps.map(
            (step, i) =>
                `${i + 1}. ${step.title}\n${step.detail}${step.evidenceIds.length ? `\nReferencias del hogar: ${step.evidenceIds.map((id) => context.records.find((record) => record.id === id)?.title ?? "").join(", ")}` : ""}`,
        ),
    ].join("\n\n");
}
