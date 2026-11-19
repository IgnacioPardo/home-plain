import { z } from "zod";
import {
    type ContentBlock,
    type ContentDocument,
    type ContentText,
    contentBlockTypeSchema,
    safeContentLink,
} from "./content.schema.ts";
import type { ContentReader } from "./content.service.ts";

const uuid = z
    .string()
    .uuid()
    .transform((id) => id.toLowerCase());
const richText = z.array(
    z.object({
        plain_text: z.string(),
        href: z.string().nullable().optional(),
        annotations: z
            .object({
                bold: z.boolean().optional(),
                italic: z.boolean().optional(),
                code: z.boolean().optional(),
                strikethrough: z.boolean().optional(),
                underline: z.boolean().optional(),
            })
            .optional(),
    }),
);
const blockSchema = z
    .object({
        object: z.literal("block"),
        id: uuid,
        type: z.string(),
        has_children: z.boolean(),
        archived: z.boolean().optional(),
        in_trash: z.boolean().optional(),
    })
    .catchall(z.unknown());
const listSchema = z.object({
    results: z.array(blockSchema),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    request_status: z.object({ incomplete_reason: z.string().nullish() }).optional(),
});
const pageSchema = z.object({
    object: z.literal("page"),
    id: uuid,
    archived: z.boolean().optional(),
    in_trash: z.boolean().optional(),
    parent: z.object({ type: z.string(), page_id: uuid.optional() }).optional(),
    properties: z.record(z.string(), z.unknown()),
});
const supported = new Set(contentBlockTypeSchema.options);

export class NotionContentReader implements ContentReader {
    constructor(
        private readonly config: {
            token: string;
            rootPageId: string;
            shoppingDataSourceId: string;
            feedbackDataSourceId?: string;
            productReferencesDataSourceId?: string;
        },
        private readonly request: typeof fetch = fetch,
        private readonly pause = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ) {}

    async readDocuments(): Promise<ContentDocument[]> {
        const documents: ContentDocument[] = [];
        const visited = new Set<string>();
        const databases = new Set<string>();
        let blockCount = 0;
        const readDocument = async (id: string, parentId: string | null) => {
            if (visited.has(id) || visited.size >= 200) throw new Error("Invalid Home hierarchy");
            visited.add(id);
            const page = pageSchema.parse(await this.read(`pages/${id}`));
            if (
                page.id !== id ||
                page.archived ||
                page.in_trash ||
                (parentId && page.parent?.page_id !== parentId)
            )
                throw new Error("Page left the Home hierarchy");
            const titleProperty = Object.values(page.properties).find(
                (property) =>
                    typeof property === "object" &&
                    property !== null &&
                    "type" in property &&
                    property.type === "title",
            );
            const title = z
                .object({ title: richText })
                .parse(titleProperty)
                .title.map((text) => text.plain_text)
                .join("");
            const document: ContentDocument = {
                id,
                parentId,
                title: title || "Sin título",
                url: `https://www.notion.so/${id.replaceAll("-", "")}`,
                blocks: [],
            };
            documents.push(document);
            document.blocks = await readBlocks(id, id, 0);
        };
        const readBlocks = async (
            id: string,
            pageId: string,
            depth: number,
        ): Promise<ContentBlock[]> => {
            if (depth > 30) throw new Error("Home block nesting is too deep");
            const blocks: ContentBlock[] = [];
            for (const raw of await this.children(id)) {
                if (++blockCount > 20_000) throw new Error("Home document limit exceeded");
                if (raw.archived || raw.in_trash) continue;
                const payload = z.record(z.string(), z.unknown()).parse(raw[raw.type] ?? {});
                const type = supported.has(raw.type as ContentBlock["type"])
                    ? (raw.type as ContentBlock["type"])
                    : "unsupported";
                const block: ContentBlock = {
                    id: raw.id,
                    type,
                    text: [],
                    children: [],
                    cells: [],
                    checked: false,
                    columnHeader: false,
                    rowHeader: false,
                    targetId: null,
                };
                if (payload.rich_text !== undefined)
                    block.text = toText(richText.parse(payload.rich_text));
                if (raw.type === "child_page") {
                    block.text = [{ ...plainText(z.string().parse(payload.title)), href: null }];
                    block.targetId = raw.id;
                    await readDocument(raw.id, pageId);
                } else if (raw.type === "child_database") {
                    const database = z
                        .object({ data_sources: z.array(z.object({ id: uuid })) })
                        .parse(await this.read(`databases/${raw.id}`));
                    const source = database.data_sources.find(
                        (source) =>
                            source.id === this.config.shoppingDataSourceId ||
                            source.id === this.config.feedbackDataSourceId ||
                            source.id === this.config.productReferencesDataSourceId,
                    );
                    if (!source) {
                        blocks.push(block);
                        continue;
                    }
                    if (databases.has(source.id)) continue;
                    databases.add(source.id);
                    block.type =
                        source.id === this.config.shoppingDataSourceId
                            ? "shopping"
                            : source.id === this.config.productReferencesDataSourceId
                              ? "catalog"
                              : "feedback";
                    block.text = [
                        plainText(
                            block.type === "shopping"
                                ? "Lista de compras"
                                : block.type === "catalog"
                                  ? "Referencias de productos"
                                  : "Comentarios y notas",
                        ),
                    ];
                    block.targetId = source.id;
                } else if (raw.type === "table") {
                    block.columnHeader = z.boolean().parse(payload.has_column_header);
                    block.rowHeader = z.boolean().parse(payload.has_row_header);
                    block.children = await readBlocks(raw.id, pageId, depth + 1);
                    if (block.children.some((row) => row.type !== "table_row"))
                        throw new Error("Invalid table rows");
                } else if (raw.type === "table_row") {
                    block.cells = z.array(richText).parse(payload.cells).map(toText);
                } else if (raw.type === "to_do") {
                    block.checked = z.boolean().parse(payload.checked);
                    if (raw.has_children)
                        block.children = await readBlocks(raw.id, pageId, depth + 1);
                } else if (raw.has_children && type !== "unsupported") {
                    block.children = await readBlocks(raw.id, pageId, depth + 1);
                }
                blocks.push(block);
            }
            return blocks;
        };
        await readDocument(this.config.rootPageId, null);
        return documents;
    }

    private async children(id: string) {
        const blocks: z.infer<typeof blockSchema>[] = [];
        const cursors = new Set<string>();
        const ids = new Set<string>();
        let cursor: string | null = null;
        for (let attempt = 0; attempt < 200; attempt++) {
            const suffix = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "";
            const response = listSchema.parse(
                await this.read(`blocks/${id}/children?page_size=100${suffix}`),
            );
            if (response.request_status?.incomplete_reason)
                throw new Error("Incomplete Home pagination");
            for (const block of response.results) {
                if (ids.has(block.id)) throw new Error("Repeated Home block");
                ids.add(block.id);
                blocks.push(block);
            }
            if (!response.has_more) return blocks;
            if (!response.next_cursor || cursors.has(response.next_cursor))
                throw new Error("Incomplete Home pagination");
            cursor = response.next_cursor;
            cursors.add(cursor);
        }
        throw new Error("Home pagination limit exceeded");
    }

    private async read(path: string): Promise<unknown> {
        for (let attempt = 0; attempt < 3; attempt++) {
            let response: Response;
            try {
                response = await this.request(`https://api.notion.com/v1/${path}`, {
                    headers: {
                        Authorization: `Bearer ${this.config.token}`,
                        "Notion-Version": "2026-03-11",
                    },
                    signal: AbortSignal.timeout(15_000),
                });
            } catch {
                if (attempt === 2) throw new Error("Notion document request failed");
                await this.pause(500 * 2 ** attempt);
                continue;
            }
            if (response.ok) return response.json();
            if ((response.status === 429 || response.status >= 500) && attempt < 2) {
                const retryAfter = response.headers.get("retry-after");
                const seconds = retryAfter === null ? 0 : Number(retryAfter);
                const delay = Number.isFinite(seconds)
                    ? seconds * 1000
                    : Math.max(0, Date.parse(retryAfter!) - Date.now());
                await this.pause(Math.max(500 * 2 ** attempt, Number.isFinite(delay) ? delay : 0));
                continue;
            }
            throw new Error("Notion document request rejected");
        }
        throw new Error("Notion document request failed");
    }
}

function toText(parts: z.infer<typeof richText>): ContentText[] {
    return parts.map((part) => ({
        ...plainText(part.plain_text),
        href: safeContentLink(part.href ?? null),
        bold: part.annotations?.bold ?? false,
        italic: part.annotations?.italic ?? false,
        code: part.annotations?.code ?? false,
        strikethrough: part.annotations?.strikethrough ?? false,
        underline: part.annotations?.underline ?? false,
    }));
}
function plainText(text: string): ContentText {
    return {
        text,
        href: null,
        bold: false,
        italic: false,
        code: false,
        strikethrough: false,
        underline: false,
    };
}
