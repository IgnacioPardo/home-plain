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
export function buildRouter(store: HomeRepository) {
    return t.router({
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
