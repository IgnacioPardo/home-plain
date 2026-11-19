import { z } from "zod";

export const feedbackTargetSchema = z
    .object({
        kind: z.enum(["document", "shopping", "collection", "moodboard", "note"]),
        id: z
            .string()
            .min(1)
            .max(100)
            .regex(/^[a-zA-Z0-9-]+$/),
    })
    .strict();
export const createFeedbackSchema = z
    .object({
        operationId: z.string().uuid(),
        kind: z.enum(["comment", "note"]),
        displayAuthor: z.enum(["Persona A", "Persona B"]),
        title: z.string().trim().max(160).default(""),
        body: z.string().trim().min(1).max(8_000),
        target: feedbackTargetSchema.nullable(),
    })
    .strict()
    .superRefine((entry, ctx) => {
        if (entry.kind === "comment" && !entry.target)
            ctx.addIssue({ code: "custom", path: ["target"], message: "A comment needs a target" });
        if (entry.kind === "note" && (!entry.title || entry.target))
            ctx.addIssue({
                code: "custom",
                path: ["title"],
                message: "A standalone note needs a title",
            });
    });
export const feedbackEntrySchema = z.object({
    id: z.string().uuid(),
    operationId: z.string().uuid(),
    kind: z.enum(["comment", "note"]),
    displayAuthor: z.enum(["Persona A", "Persona B", "Agente"]),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(8_000),
    target: feedbackTargetSchema.nullable(),
    contextUrl: z.string().url(),
    createdAt: z.string().datetime(),
});
export const feedbackSnapshotSchema = z
    .object({
        version: z.literal(1),
        dataSourceId: z.string().uuid(),
        syncedAt: z.string().datetime(),
        entries: z.array(feedbackEntrySchema),
    })
    .superRefine((snapshot, ctx) => {
        for (const key of ["id", "operationId"] as const)
            if (
                new Set(snapshot.entries.map((entry) => entry[key])).size !==
                snapshot.entries.length
            )
                ctx.addIssue({ code: "custom", message: `Duplicate feedback ${key}` });
    });
export const feedbackListSchema = z.object({
    configured: z.boolean(),
    canCreate: z.boolean(),
    state: z.enum(["unconfigured", "syncing", "live", "stale", "error", "offline"]),
    issue: z
        .enum([
            "not_configured",
            "upstream_unavailable",
            "cache_unavailable",
            "journal_unavailable",
        ])
        .nullable(),
    snapshot: z
        .object({ syncedAt: z.string().datetime(), entries: z.array(feedbackEntrySchema) })
        .nullable(),
});
export const feedbackCreateResultSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("saved"), entry: feedbackEntrySchema }),
    z.object({ status: z.literal("unconfirmed"), operationId: z.string().uuid() }),
]);
export type FeedbackTarget = z.infer<typeof feedbackTargetSchema>;
export type CreateFeedback = z.infer<typeof createFeedbackSchema>;
export type FeedbackEntry = z.infer<typeof feedbackEntrySchema>;
export type FeedbackSnapshot = z.infer<typeof feedbackSnapshotSchema>;
export type FeedbackList = z.infer<typeof feedbackListSchema>;
export type FeedbackCreateResult = z.infer<typeof feedbackCreateResultSchema>;
