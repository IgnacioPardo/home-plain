import { z } from "zod";
import { safeContentLink } from "../content/content.schema.ts";

export const collectionSourceSchema = z.object({
    title: z.string(),
    url: z.string().refine((url) => safeContentLink(url) !== null, "Unsafe source URL"),
});
export const collectionMediaPathSchema = z
    .string()
    .regex(/^\/media\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/);
const legacyEntrySchema = z.object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    kind: z.enum(["object", "reference", "note"]),
    title: z.string(),
    subtitle: z.string(),
    body: z.string(),
    category: z.string(),
    label: z.string(),
    image: collectionMediaPathSchema.nullable(),
    imageAlt: z.string(),
    source: collectionSourceSchema,
    imageSource: collectionSourceSchema.nullable(),
    shoppingItemId: z.string().uuid().nullable(),
    layout: z.enum(["wide", "portrait", "square", "note"]),
    tone: z.enum(["paper", "stone", "sage", "blue", "clay"]),
});
export const catalogCategories = [
    "Hogar",
    "Trabajo",
    "Audio y música",
    "Tecnología",
    "Fotografía",
    "Ropa y calzado",
    "Accesorios personales",
    "Deporte y movilidad",
    "Otros",
] as const;
export const collectionImageSchema = z.object({
    path: collectionMediaPathSchema,
    alt: z.string(),
    source: collectionSourceSchema,
    role: z.enum(["product", "owned", "context"]),
});
export const collectionEntrySchema = legacyEntrySchema
    .extend({
        provenance: z.enum(["my-gear", "home-reference", "legacy"]),
        ownership: z.enum(["owned", "reference", "unknown"]),
        productSource: collectionSourceSchema.nullable(),
        brand: z.string().nullable(),
        model: z.string().nullable(),
        materials: z.array(z.string()),
        reason: z.string().nullable(),
        rooms: z.array(z.string()),
        shoppingRelation: z.enum(["exact", "contextual"]).nullable(),
        images: z.array(collectionImageSchema),
    })
    .superRefine((entry, ctx) => {
        if (entry.kind === "note" && (entry.image !== null || entry.images.length))
            ctx.addIssue({ code: "custom", message: "Notes cannot have product images" });
        if (!entry.shoppingItemId && entry.shoppingRelation)
            ctx.addIssue({ code: "custom", message: "Shopping relation requires a shopping item" });
        if (entry.image !== (entry.images[0]?.path ?? null))
            ctx.addIssue({ code: "custom", message: "Primary image must match the gallery" });
    });
const legacySnapshotSchema = z.object({
    version: z.literal(1),
    source: z.literal("import"),
    importedAt: z.string().datetime(),
    entries: z.array(legacyEntrySchema),
});
const snapshotV2Schema = z.object({
    version: z.literal(2),
    source: z.literal("import"),
    importedAt: z.string().datetime(),
    entries: z.array(collectionEntrySchema),
});
export const collectionSnapshotSchema = z
    .union([
        snapshotV2Schema,
        legacySnapshotSchema.transform((snapshot) => ({
            ...snapshot,
            version: 2 as const,
            entries: snapshot.entries.map((entry) => ({
                ...entry,
                image: entry.kind === "note" ? null : entry.image,
                imageSource: entry.kind === "note" ? null : entry.imageSource,
                provenance: "legacy" as const,
                ownership: "unknown" as const,
                productSource: null,
                brand: null,
                model: null,
                materials: [],
                reason: null,
                rooms: [],
                shoppingRelation: entry.shoppingItemId ? ("contextual" as const) : null,
                images:
                    entry.image && entry.kind !== "note"
                        ? [
                              {
                                  path: entry.image,
                                  alt: entry.imageAlt,
                                  source: entry.imageSource ?? entry.source,
                                  role: "context" as const,
                              },
                          ]
                        : [],
            })),
        })),
    ])
    .superRefine((snapshot, ctx) => {
        if (new Set(snapshot.entries.map((entry) => entry.id)).size !== snapshot.entries.length)
            ctx.addIssue({ code: "custom", message: "Duplicate collection IDs" });
        const exact = snapshot.entries.filter((entry) => entry.shoppingRelation === "exact");
        if (new Set(exact.map((entry) => entry.shoppingItemId)).size !== exact.length)
            ctx.addIssue({ code: "custom", message: "Multiple references for one shopping need" });
    });
export const collectionStatusSchema = z.object({
    state: z.enum(["ready", "missing", "stale"]),
    importedAt: z.string().datetime().nullable(),
    issue: z.string().nullable(),
});
export type CollectionEntry = z.infer<typeof collectionEntrySchema>;
export type CollectionSnapshot = z.infer<typeof collectionSnapshotSchema>;
export type CollectionSnapshotInput = z.input<typeof collectionSnapshotSchema>;
export type CollectionStatus = z.infer<typeof collectionStatusSchema>;
