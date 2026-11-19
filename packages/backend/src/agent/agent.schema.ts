import { z } from "zod";

export class InvalidAgentProposal extends Error {
    constructor() {
        super("Invalid planning proposal");
    }
}

export const startAgentSchema = z.strictObject({
    operationId: z.string().uuid(),
    room: z.string().trim().min(1).max(100),
    goal: z.string().trim().min(10).max(2000),
});
export const agentContextSchema = z.strictObject({
    room: z.string(),
    goal: z.string(),
    records: z
        .array(z.strictObject({ id: z.string(), title: z.string(), detail: z.string() }))
        .max(50),
});
export const agentProposalSchema = z.strictObject({
    summary: z.string().trim().min(1).max(2000),
    steps: z
        .array(
            z.strictObject({
                title: z.string().trim().min(1).max(160),
                detail: z.string().trim().min(1).max(1000),
                evidenceIds: z.array(z.string().max(150)).max(10),
            }),
        )
        .min(1)
        .max(12),
});
export const agentRunSchema = z.object({
    id: z.string().uuid(),
    room: z.string(),
    goal: z.string(),
    status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
    progress: z.enum(["queued", "planning", "review", "failed", "canceled"]),
    attempts: z.number().int().nonnegative(),
    proposal: agentProposalSchema.nullable(),
    decision: z.enum(["pending", "applied", "dismissed"]),
    noteId: z.string().uuid().nullable(),
    issue: z.enum(["provider_failed", "attempts_exhausted", "access_revoked"]).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    sources: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type StartAgent = z.infer<typeof startAgentSchema>;
export type AgentContext = z.infer<typeof agentContextSchema>;
export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentPlanner = { plan(context: AgentContext, signal: AbortSignal): Promise<unknown> };
