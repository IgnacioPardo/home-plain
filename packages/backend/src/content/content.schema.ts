import { z } from "zod";

export const contentTextSchema = z.object({
    text: z.string(),
    href: z
        .string()
        .refine((value) => safeContentLink(value) !== null, "Unsafe content link")
        .nullable(),
    bold: z.boolean(),
    italic: z.boolean(),
    code: z.boolean(),
    strikethrough: z.boolean(),
    underline: z.boolean(),
});
export type ContentText = z.infer<typeof contentTextSchema>;
export const contentBlockTypeSchema = z.enum([
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "bulleted_list_item",
    "numbered_list_item",
    "quote",
    "callout",
    "toggle",
    "to_do",
    "divider",
    "table",
    "table_row",
    "table_of_contents",
    "column_list",
    "column",
    "child_page",
    "shopping",
    "feedback",
    "catalog",
    "unsupported",
]);
export type ContentBlock = {
    id: string;
    type: z.infer<typeof contentBlockTypeSchema>;
    text: ContentText[];
    children: ContentBlock[];
    cells: ContentText[][];
    checked: boolean;
    columnHeader: boolean;
    rowHeader: boolean;
    targetId: string | null;
};
export const contentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() =>
    z.object({
        id: z.string().uuid(),
        type: contentBlockTypeSchema,
        text: z.array(contentTextSchema),
        children: z.array(contentBlockSchema),
        cells: z.array(z.array(contentTextSchema)),
        checked: z.boolean(),
        columnHeader: z.boolean(),
        rowHeader: z.boolean(),
        targetId: z.string().uuid().nullable(),
    }),
);
export const contentDocumentSchema = z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    title: z.string(),
    url: z
        .string()
        .url()
        .refine((value) => safeContentLink(value) !== null, "Unsafe source URL"),
    blocks: z.array(contentBlockSchema),
});
export type ContentDocument = z.infer<typeof contentDocumentSchema>;
export const contentSnapshotSchema = z
    .object({
        version: z.literal(1),
        rootPageId: z.string().uuid(),
        syncedAt: z.string().datetime(),
        documents: z.array(contentDocumentSchema),
    })
    .superRefine((value, ctx) => {
        const ids = new Set(value.documents.map((document) => document.id));
        if (ids.size !== value.documents.length || !ids.has(value.rootPageId))
            ctx.addIssue({ code: "custom", message: "Incomplete or duplicate document hierarchy" });
        if (value.documents.find((document) => document.id === value.rootPageId)?.parentId !== null)
            ctx.addIssue({ code: "custom", message: "Home root must not have a projected parent" });
        for (const document of value.documents) {
            const seen = new Set<string>();
            let current = document;
            while (current.id !== value.rootPageId) {
                if (seen.has(current.id) || !current.parentId || !ids.has(current.parentId)) {
                    ctx.addIssue({ code: "custom", message: "Document is outside Home" });
                    break;
                }
                seen.add(current.id);
                current = value.documents.find((candidate) => candidate.id === current.parentId)!;
            }
        }
    });
export type ContentSnapshot = z.infer<typeof contentSnapshotSchema>;
const stateFields = {
    configured: z.boolean(),
    state: z.enum(["live", "stale", "offline", "unconfigured", "syncing", "error"]),
    syncedAt: z.string().datetime().nullable(),
};
export const contentIndexSchema = z.object({
    ...stateFields,
    documents: z.array(
        z.object({
            id: z.string().uuid(),
            parentId: z.string().uuid().nullable(),
            title: z.string(),
            searchText: z.string(),
        }),
    ),
});
export const contentDocumentResultSchema = z.object({
    ...stateFields,
    document: contentDocumentSchema.nullable(),
});
export type ContentIndex = z.infer<typeof contentIndexSchema>;
export type ContentDocumentResult = z.infer<typeof contentDocumentResultSchema>;

export function safeContentLink(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return null;
        if (/amazonaws\.com$|notion-static\.com$|prod-files-secure\.s3/i.test(url.hostname))
            return null;
        if ([...url.searchParams.keys()].some((key) => /^(x-amz-|signature$|token$)/i.test(key)))
            return null;
        return url.href;
    } catch {
        return null;
    }
}
