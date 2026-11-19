import { z } from "zod";
import { catalogCategories, collectionSourceSchema } from "./collection.schema.ts";

export type CatalogRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;
const uuid = z
    .string()
    .uuid()
    .transform((id) => id.toLowerCase());
const textParts = z.array(z.object({ plain_text: z.string() }));
const textProperty = z.object({ type: z.literal("rich_text"), rich_text: textParts });
const titleProperty = z.object({ type: z.literal("title"), title: textParts });
const urlProperty = z.object({ type: z.literal("url"), url: z.string().nullable() });
const pageSchema = z.object({
    object: z.literal("page"),
    id: uuid,
    archived: z.boolean().optional(),
    in_trash: z.boolean().optional(),
    properties: z.record(z.string(), z.unknown()),
    cover: z.unknown().optional(),
    parent: z.object({ type: z.string(), data_source_id: uuid.optional() }),
});
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
    results: z.array(z.unknown()),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    request_status: z.object({ incomplete_reason: z.string().nullish() }).optional(),
});
export type CatalogPage = z.infer<typeof pageSchema>;
export const gearRecordSchema = z.object({
    pageId: uuid,
    title: z.string().min(1),
    tags: z.array(z.string()),
    website: z.string().nullable(),
    images: z.array(z.string().url()),
});
export type GearRecord = z.infer<typeof gearRecordSchema>;
export const gearSourceCacheSchema = z.object({
    version: z.literal(1),
    dataSourceId: uuid,
    capturedAt: z.string().datetime(),
    records: z.array(gearRecordSchema),
});
export type ProductRecord = {
    pageId: string;
    shoppingItemId: string;
    title: string;
    brand: string;
    model: string;
    materials: string[];
    reason: string;
    category: string;
    rooms: string[];
    source: z.infer<typeof collectionSourceSchema>;
    imageSource: z.infer<typeof collectionSourceSchema>;
    images: string[];
};
const sourceUrl = (url: string | null) => collectionSourceSchema.shape.url.parse(url);
const plain = (value: unknown) =>
    textProperty
        .parse(value)
        .rich_text.map((part) => part.plain_text)
        .join("")
        .trim();
const title = (value: unknown) =>
    titleProperty
        .parse(value)
        .title.map((part) => part.plain_text)
        .join("")
        .trim();
const url = (value: unknown) => urlProperty.parse(value).url;

/** Reads only safe field allowlists. Raw page properties and nested text are never projected. */
export class CatalogNotionReader {
    constructor(private readonly request: CatalogRequest) {}
    async pages(dataSourceId: string): Promise<CatalogPage[]> {
        const results = await this.paginate(`data_sources/${dataSourceId}/query`, true);
        const pages = results.map((value) => pageSchema.parse(value));
        const ids = new Set<string>();
        for (const page of pages) {
            if (page.parent.data_source_id !== dataSourceId || ids.has(page.id))
                throw new Error("Catalog query returned an invalid source or repeated page");
            ids.add(page.id);
        }
        return pages.filter((page) => !page.archived && !page.in_trash);
    }
    async gear(dataSourceId: string): Promise<GearRecord[]> {
        const records: GearRecord[] = [];
        for (const page of await this.pages(dataSourceId)) {
            const sold = z
                .object({ type: z.literal("checkbox"), checkbox: z.boolean() })
                .parse(page.properties.Sold);
            if (sold.checkbox) continue;
            const name = z.string().min(1).parse(title(page.properties.Name));
            const tags = z
                .object({
                    type: z.literal("multi_select"),
                    multi_select: z.array(z.object({ name: z.string() })),
                })
                .parse(page.properties.Tags)
                .multi_select.map((tag) => tag.name);
            const website = url(page.properties.Website);
            const images = await this.images(page);
            records.push({
                pageId: page.id,
                title: name,
                tags,
                website: safeWebsite(website),
                images,
            });
        }
        return records;
    }
    async products(dataSourceId: string): Promise<ProductRecord[]> {
        const records: ProductRecord[] = [];
        for (const page of await this.pages(dataSourceId)) {
            const p = page.properties;
            const name = z.string().min(1).parse(title(p.Nombre));
            const brand = z.string().min(1).parse(plain(p.Marca));
            const model = z.string().min(1).parse(plain(p.Modelo));
            const source = { title: `${brand} · ${model}`, url: sourceUrl(url(p.Fuente)) };
            const imageSource = {
                title: `${brand} · imagen de producto`,
                url: sourceUrl(url(p["Fuente imagen"]) ?? source.url),
            };
            const primary = url(p.Imagen);
            records.push({
                pageId: page.id,
                shoppingItemId: uuid.parse(plain(p["Compra ID"])),
                title: name,
                brand,
                model,
                materials: plain(p.Materiales)
                    .split(";")
                    .map((part) => part.trim())
                    .filter(Boolean),
                reason: z.string().min(1).parse(plain(p.Motivo)),
                category: z
                    .object({
                        type: z.literal("select"),
                        select: z.object({ name: z.enum(catalogCategories) }),
                    })
                    .parse(p["Categoría"]).select.name,
                rooms: z
                    .object({
                        type: z.literal("multi_select"),
                        multi_select: z.array(z.object({ name: z.string() })),
                    })
                    .parse(p.Ambientes)
                    .multi_select.map((room) => room.name),
                source,
                imageSource,
                images: [...new Set([...(primary ? [primary] : []), ...(await this.images(page))])],
            });
        }
        return records;
    }
    private async images(page: CatalogPage): Promise<string[]> {
        const images: string[] = [];
        const cover = imageUrl(page.cover);
        if (cover) images.push(cover);
        const seen = new Set<string>(),
            blocksSeen = new Set<string>();
        const visit = async (id: string, depth: number) => {
            if (depth > 20 || seen.size > 5000 || seen.has(id))
                throw new Error("Invalid catalog image hierarchy");
            seen.add(id);
            for (const value of await this.paginate(`blocks/${id}/children`, false)) {
                const block = blockSchema.parse(value);
                if (blocksSeen.has(block.id)) throw new Error("Repeated catalog image block");
                blocksSeen.add(block.id);
                if (block.archived || block.in_trash) continue;
                if (block.type === "image") {
                    const image = imageUrl(block.image);
                    if (image) images.push(image);
                }
                // Child pages/databases can hold receipts and unrelated records. Do not follow them.
                if (
                    block.has_children &&
                    !["child_page", "child_database", "link_to_page", "synced_block"].includes(
                        block.type,
                    )
                )
                    await visit(block.id, depth + 1);
            }
        };
        await visit(page.id, 0);
        return [...new Set(images)];
    }
    private async paginate(path: string, post: boolean): Promise<unknown[]> {
        const values: unknown[] = [],
            cursors = new Set<string>();
        let cursor: string | null = null;
        for (let page = 0; page < 200; page++) {
            const response = listSchema.parse(
                await this.request(
                    post
                        ? path
                        : `${path}?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`,
                    post
                        ? { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
                        : undefined,
                ),
            );
            if (response.request_status?.incomplete_reason)
                throw new Error("Incomplete catalog pagination");
            values.push(...response.results);
            if (!response.has_more) return values;
            if (!response.next_cursor || cursors.has(response.next_cursor))
                throw new Error("Incomplete catalog pagination");
            cursor = response.next_cursor;
            cursors.add(cursor);
        }
        throw new Error("Catalog pagination limit exceeded");
    }
}
function imageUrl(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const image = z
        .object({
            type: z.string(),
            file: z.object({ url: z.string() }).optional(),
            external: z.object({ url: z.string() }).optional(),
        })
        .parse(value);
    return image.type === "file"
        ? (image.file?.url ?? null)
        : image.type === "external"
          ? (image.external?.url ?? null)
          : null;
}
function safeWebsite(value: string | null): string | null {
    if (!value) return null;
    const parsed = collectionSourceSchema.shape.url.safeParse(value);
    return parsed.success ? parsed.data : null;
}
