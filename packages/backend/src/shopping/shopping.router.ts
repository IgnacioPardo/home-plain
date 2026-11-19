import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    createFeedbackSchema,
    feedbackCreateResultSchema,
    feedbackListSchema,
    feedbackTargetSchema,
} from "../feedback/feedback.schema.ts";
import type { FeedbackService } from "../feedback/feedback.service.ts";
import { FeedbackError } from "../feedback/feedback.errors.ts";

import type { ContentService } from "../content/content.service.ts";
import { contentIndexSchema, contentDocumentResultSchema } from "../content/content.schema.ts";

import { t, protectedProcedure, ownerProcedure } from "../trpc.ts";
import { authSessionSchema } from "../auth/auth.schema.ts";
import { ShoppingWriteError } from "./shopping.errors.ts";
import { setPurchasedSchema, shoppingDashboardSchema } from "./shopping.schema.ts";
import type { ShoppingService } from "./shopping.service.ts";
import {
    readCollection,
    readCollectionStatus,
    type CollectionSource,
} from "../collection/collection.service.ts";
import type { MoodboardService } from "../moodboard/moodboard.repository.ts";
import { moodboardSnapshotSchema, type MoodboardSnapshot } from "../moodboard/moodboard.schema.ts";
import {
    collectionSnapshotSchema,
    collectionStatusSchema,
} from "../collection/collection.schema.ts";

export function buildRouter(
    service: ShoppingService,
    collection: CollectionSource = null,
    moodboard: MoodboardSnapshot | MoodboardService | null = null,
    options: { content?: ContentService; feedback?: FeedbackService | null } = {},
) {
    return t.router({
        feedback: t.router({
            list: protectedProcedure
                .input(z.object({ target: feedbackTargetSchema.nullable() }))
                .output(feedbackListSchema)
                .query(async ({ input }) => {
                    if (!options.feedback)
                        return {
                            configured: false,
                            canCreate: false,
                            state: "unconfigured" as const,
                            issue: "not_configured" as const,
                            snapshot: null,
                        };
                    try {
                        return await options.feedback.list(input.target);
                    } catch (error) {
                        throw feedbackError(error);
                    }
                }),
            create: protectedProcedure
                .input(createFeedbackSchema)
                .output(feedbackCreateResultSchema)
                .mutation(async ({ input }) => {
                    if (!options.feedback) throw feedbackError(new FeedbackError("unconfigured"));
                    try {
                        return await options.feedback.create(input);
                    } catch (error) {
                        throw feedbackError(error);
                    }
                }),
        }),
        content: t.router({
            index: protectedProcedure.output(contentIndexSchema).query(() => {
                void options.content?.refreshIfDue();
                return (
                    options.content?.readIndex() ?? {
                        configured: false,
                        state: "unconfigured",
                        syncedAt: null,
                        documents: [],
                    }
                );
            }),
            document: protectedProcedure
                .input(
                    z.object({
                        id: z
                            .string()
                            .uuid()
                            .transform((id) => id.toLowerCase()),
                    }),
                )
                .output(contentDocumentResultSchema)
                .query(({ input }) => {
                    void options.content?.refreshIfDue();
                    const result = options.content?.readDocument(input.id);
                    if (result && result.syncedAt && !result.document)
                        throw new TRPCError({
                            code: "NOT_FOUND",
                            message: "El documento no está compartido en Home.",
                        });
                    return (
                        result ?? {
                            configured: false,
                            state: "unconfigured",
                            syncedAt: null,
                            document: null,
                        }
                    );
                }),
        }),
        auth: t.router({
            session: protectedProcedure.output(authSessionSchema).query(({ ctx }) => ctx.session),
        }),
        moodboard: protectedProcedure
            .output(moodboardSnapshotSchema.nullable())
            .query(() => (moodboard && "read" in moodboard ? moodboard.read() : moodboard)),
        collection: protectedProcedure
            .output(collectionSnapshotSchema.nullable())
            .query(() => readCollection(collection)),
        collectionStatus: protectedProcedure
            .output(collectionStatusSchema)
            .query(() => readCollectionStatus(collection)),
        shopping: t.router({
            dashboard: protectedProcedure
                .output(shoppingDashboardSchema)
                .query(() => service.read()),
            refresh: protectedProcedure
                .output(shoppingDashboardSchema)
                .mutation(() => service.refresh()),
            setPurchased: ownerProcedure
                .input(setPurchasedSchema)
                .output(shoppingDashboardSchema)
                .mutation(async ({ input }) => {
                    try {
                        return await service.setPurchased(input);
                    } catch (error) {
                        if (!(error instanceof ShoppingWriteError))
                            throw new TRPCError({
                                code: "INTERNAL_SERVER_ERROR",
                                message: "No se pudo actualizar la compra.",
                            });
                        const errors = {
                            schema: {
                                code: "PRECONDITION_FAILED",
                                message:
                                    "La propiedad Estado de Notion cambió. Revisá que existan las opciones Comprado y En lista.",
                            },
                            unconfigured: {
                                code: "PRECONDITION_FAILED",
                                message: "Conectá Notion para guardar el estado de compra.",
                            },
                            not_found: {
                                code: "NOT_FOUND",
                                message:
                                    "El objeto ya no está disponible en esta lista. Actualizá los datos.",
                            },
                            conflict: {
                                code: "CONFLICT",
                                message:
                                    "El estado cambió en Notion. Actualizá la lista antes de volver a marcarlo.",
                            },
                            forbidden: {
                                code: "FORBIDDEN",
                                message:
                                    "Notion no permite actualizar este objeto. Revisá el acceso y el permiso de actualización de la integración.",
                            },
                            unavailable: {
                                code: "BAD_GATEWAY",
                                message:
                                    "No se pudo guardar en Notion. Actualizá la lista antes de volver a intentar.",
                            },
                            uncertain: {
                                code: "BAD_GATEWAY",
                                message:
                                    "No pudimos confirmar el cambio en Notion. Actualizá la lista antes de volver a intentar.",
                            },
                        } as const;
                        throw new TRPCError(errors[error.reason]);
                    }
                }),
        }),
    });
}
export type AppRouter = ReturnType<typeof buildRouter>;

function feedbackError(error: unknown): TRPCError {
    const messages = {
        unconfigured: "Los comentarios todavía no están conectados a Notion.",
        invalid_target: "Este contenido no está disponible para comentar.",
        operation_conflict:
            "Este envío ya existe con otro contenido. Revisá los comentarios antes de crear otro.",
        journal_unavailable:
            "No se puede guardar con seguridad en este momento. Conservá tu texto y volvé a comprobar más tarde.",
        schema: "La estructura de Comentarios y notas cambió en Notion.",
        rejected: "Notion rechazó el envío. Conservá tu texto y volvé a intentar más tarde.",
        unavailable:
            "No se pudo conectar con Notion. Conservá tu texto y comprobá el envío antes de intentar otro.",
        uncertain: "No se pudo confirmar el guardado. Comprobá este envío antes de intentar otro.",
    };
    const reason = error instanceof FeedbackError ? error.reason : "unavailable";
    return new TRPCError({
        code:
            reason === "invalid_target"
                ? "NOT_FOUND"
                : reason === "operation_conflict"
                  ? "CONFLICT"
                  : reason === "unconfigured" ||
                      reason === "schema" ||
                      reason === "journal_unavailable"
                    ? "PRECONDITION_FAILED"
                    : "BAD_GATEWAY",
        message: messages[reason],
    });
}
