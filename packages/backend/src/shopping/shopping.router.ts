import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t, protectedProcedure, ownerProcedure } from "../trpc.ts";
import { authSessionSchema } from "../auth/auth.schema.ts";
import { HomeError, type HomeStore } from "../database/home.store.ts";
import { setPurchasedSchema, shoppingDashboardSchema } from "./shopping.schema.ts";
import {
    collectionSnapshotSchema,
    collectionStatusSchema,
} from "../collection/collection.schema.ts";
import { contentIndexSchema, contentDocumentResultSchema } from "../content/content.schema.ts";
import { moodboardSnapshotSchema } from "../moodboard/moodboard.schema.ts";
import {
    createFeedbackSchema,
    feedbackCreateResultSchema,
    feedbackListSchema,
    feedbackTargetSchema,
} from "../feedback/feedback.schema.ts";

import { AgentRunStore, AgentError } from "../agent/agent.store.ts";
import { agentRunSchema, startAgentSchema } from "../agent/agent.schema.ts";

export type HomeRepository = Pick<
    HomeStore,
    | "dashboard"
    | "setPurchased"
    | "collection"
    | "collectionStatus"
    | "contentIndex"
    | "document"
    | "moodboard"
    | "listFeedback"
    | "createFeedback"
    | "hasMedia"
>;
export function buildRouter(store: HomeRepository, agent?: AgentRunStore) {
    const runs = () => {
        if (!agent) throw new AgentError("unconfigured");
        return agent;
    };
    return t.router({
        agent: t.router({
            list: protectedProcedure
                .output(z.object({ configured: z.boolean(), runs: z.array(agentRunSchema) }))
                .query(({ ctx }) =>
                    safely(() =>
                        agent
                            ? agent.list(ctx.session)
                            : Promise.resolve({ configured: false, runs: [] }),
                    ),
                ),
            get: protectedProcedure
                .input(z.strictObject({ id: z.string().uuid() }))
                .output(agentRunSchema)
                .query(({ ctx, input }) => safely(() => runs().get(ctx.session, input.id))),
            start: ownerProcedure
                .input(startAgentSchema)
                .output(agentRunSchema)
                .mutation(({ ctx, input }) => safely(() => runs().start(ctx.session, input))),
            cancel: ownerProcedure
                .input(z.strictObject({ id: z.string().uuid() }))
                .output(agentRunSchema)
                .mutation(({ ctx, input }) => safely(() => runs().cancel(ctx.session, input.id))),
            decide: ownerProcedure
                .input(
                    z.strictObject({
                        id: z.string().uuid(),
                        decision: z.enum(["applied", "dismissed"]),
                    }),
                )
                .output(agentRunSchema)
                .mutation(({ ctx, input }) =>
                    safely(() => runs().decide(ctx.session, input.id, input.decision)),
                ),
        }),
        auth: t.router({
            session: protectedProcedure.output(authSessionSchema).query(({ ctx }) => ctx.session),
        }),
        shopping: t.router({
            dashboard: protectedProcedure
                .output(shoppingDashboardSchema)
                .query(({ ctx }) => safely(() => store.dashboard(ctx.session))),
            refresh: protectedProcedure
                .output(shoppingDashboardSchema)
                .mutation(({ ctx }) => safely(() => store.dashboard(ctx.session))),
            setPurchased: ownerProcedure
                .input(setPurchasedSchema)
                .output(shoppingDashboardSchema)
                .mutation(({ ctx, input }) => safely(() => store.setPurchased(ctx.session, input))),
        }),
        collection: protectedProcedure
            .output(collectionSnapshotSchema.nullable())
            .query(({ ctx }) => safely(() => store.collection(ctx.session))),
        collectionStatus: protectedProcedure
            .output(collectionStatusSchema)
            .query(({ ctx }) => safely(() => store.collectionStatus(ctx.session))),
        moodboard: protectedProcedure
            .output(moodboardSnapshotSchema.nullable())
            .query(({ ctx }) => safely(() => store.moodboard(ctx.session))),
        content: t.router({
            index: protectedProcedure
                .output(contentIndexSchema)
                .query(({ ctx }) => safely(() => store.contentIndex(ctx.session))),
            document: protectedProcedure
                .input(
                    z.strictObject({
                        id: z
                            .string()
                            .uuid()
                            .transform((id) => id.toLowerCase()),
                    }),
                )
                .output(contentDocumentResultSchema)
                .query(({ ctx, input }) => safely(() => store.document(ctx.session, input.id))),
        }),
        feedback: t.router({
            list: protectedProcedure
                .input(z.strictObject({ target: feedbackTargetSchema.nullable() }))
                .output(feedbackListSchema)
                .query(({ ctx, input }) =>
                    safely(() => store.listFeedback(ctx.session, input.target)),
                ),
            create: protectedProcedure
                .input(createFeedbackSchema)
                .output(feedbackCreateResultSchema)
                .mutation(({ ctx, input }) =>
                    safely(() => store.createFeedback(ctx.session, input)),
                ),
        }),
    });
}
export type AppRouter = ReturnType<typeof buildRouter>;
async function safely<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof AgentError)
            throw new TRPCError({
                code: error.reason === "unconfigured" ? "PRECONDITION_FAILED" : "TOO_MANY_REQUESTS",
                message:
                    error.reason === "unconfigured"
                        ? "El agente todavía no está configurado."
                        : "Se alcanzó el límite de ejecuciones de este hogar. Volvé a intentar más tarde.",
            });
        if (error instanceof HomeError) {
            const messages = {
                not_found: {
                    code: "NOT_FOUND",
                    message: "Este contenido no está disponible en tu hogar.",
                },
                forbidden: { code: "FORBIDDEN", message: "No tenés permiso para esta acción." },
                conflict: {
                    code: "CONFLICT",
                    message:
                        "El contenido cambió o el envío ya existe. Actualizá antes de volver a intentar.",
                },
            } as const;
            throw new TRPCError(messages[error.reason]);
        }
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo completar la operación. Conservá tus cambios y volvé a intentar.",
        });
    }
}
