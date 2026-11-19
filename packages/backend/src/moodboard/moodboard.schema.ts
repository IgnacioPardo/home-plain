import { z } from "zod";

const sourceUrl = z
    .string()
    .url()
    .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    }, "Use an HTTPS source page without embedded credentials");
const localImage = z
    .string()
    .regex(/^\/media\/(?:atlas|pin)-[a-f0-9-]+\.jpg$/)
    .nullable();
const referenceFields = {
    id: z.string().regex(/^[a-f0-9]{14}$/),
    title: z.string().min(1),
    projectKey: sourceUrl,
    source: sourceUrl,
    publisher: z.string().min(1),
    styles: z.array(z.string().min(1)),
    rooms: z.array(z.string().min(1)),
    objects: z.array(z.string().min(1)),
    note: z.string(),
    quality: z.enum(["autor", "editorial", "social"]),
    palette: z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)),
    hero: z.boolean(),
    collection: z.enum(["atlas", "pinterest"]).optional(),
};
export const moodboardReferenceSchema = z.object({
    ...referenceFields,
    image: localImage,
    thumbnail: localImage,
});
const referencesSchema = z
    .array(moodboardReferenceSchema)
    .min(1)
    .superRefine((refs, ctx) => {
        if (new Set(refs.map((ref) => ref.id)).size !== refs.length)
            ctx.addIssue({ code: "custom", message: "Duplicate reference IDs" });
    });
export const moodboardSnapshotSchema = z.object({
    version: z.literal(1),
    importedAt: z.string().datetime(),
    source: z.object({
        title: z.string().min(1),
        url: sourceUrl,
        conversation: sourceUrl.nullable().default(null),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    status: z.literal("exploratory"),
    collections: z
        .array(
            z.object({
                id: z.enum(["atlas", "pinterest"]),
                title: z.string().min(1),
                url: sourceUrl,
                importedAt: z.string().datetime(),
            }),
        )
        .optional(),
    references: referencesSchema,
});
export const pinterestSelectionSchema = z.object({
    title: z.string().min(1),
    url: sourceUrl,
    references: z
        .array(z.object({ ...referenceFields }))
        .min(1)
        .superRefine((refs, ctx) => {
            if (new Set(refs.map((ref) => ref.id)).size !== refs.length)
                ctx.addIssue({ code: "custom", message: "Duplicate reference IDs" });
        }),
});
export const atlasExportSchema = z
    .object({
        source: z.object({ url: sourceUrl, conversation: sourceUrl.nullable().default(null) }),
        title: z.string().min(1),
        references: z
            .array(
                z.object({
                    ...referenceFields,
                    image: z.string().regex(/^images\/[a-f0-9]{14}\.jpg$/),
                    thumb: z.string().regex(/^images\/[a-f0-9]{14}-t\.jpg$/),
                }),
            )
            .min(1),
        counts: z.object({
            images: z.number().int().positive(),
            sources: z.number().int().positive(),
            styles: z.number().int().positive(),
        }),
    })
    .superRefine((data, ctx) => {
        const refs = data.references;
        if (
            new Set(refs.map((ref) => ref.id)).size !== refs.length ||
            refs.length !== data.counts.images ||
            new Set(refs.map((ref) => ref.projectKey)).size !== data.counts.sources ||
            new Set(refs.flatMap((ref) => ref.styles)).size !== data.counts.styles ||
            refs.some(
                (ref) =>
                    ref.image !== `images/${ref.id}.jpg` || ref.thumb !== `images/${ref.id}-t.jpg`,
            )
        )
            ctx.addIssue({ code: "custom", message: "Incomplete or inconsistent atlas export" });
    });
export type MoodboardReference = z.infer<typeof moodboardReferenceSchema>;
export type MoodboardSnapshot = z.infer<typeof moodboardSnapshotSchema>;
