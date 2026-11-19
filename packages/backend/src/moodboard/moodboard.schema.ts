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
export type MoodboardReference = z.infer<typeof moodboardReferenceSchema>;
export type MoodboardSnapshot = z.infer<typeof moodboardSnapshotSchema>;
