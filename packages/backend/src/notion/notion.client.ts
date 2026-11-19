import { z } from "zod";
import {
    shoppingItemSchema,
    type SetPurchased,
    type ShoppingItem,
} from "../shopping/shopping.schema.ts";
import { ShoppingWriteError } from "../shopping/shopping.errors.ts";
import { NotionReadError } from "./notion.errors.ts";

const richText = z.array(z.object({ plain_text: z.string() }));
const textProperty = z.object({ type: z.literal("rich_text"), rich_text: richText });
const selectProperty = z.object({
    type: z.literal("select"),
    select: z.object({ name: z.string() }).nullable(),
});
const pageSchema = z.object({
    object: z.literal("page"),
    id: z.string().uuid(),
    url: z.string().url(),
    properties: z.object({
        Nombre: z.object({ type: z.literal("title"), title: richText.min(1) }),
        Ambiente: selectProperty,
        Prioridad: selectProperty,
        Estado: selectProperty,
        Origen: selectProperty,
        "Cantidad inicial": textProperty,
        "Cantidad objetivo": textProperty,
        "Calidad mínima": textProperty,
        "Condición de compra": textProperty,
        Notas: textProperty,
        "Precio estimado ARS": z.object({
            type: z.literal("number"),
            number: z.number().nonnegative().nullable(),
        }),
        Referencia: z.object({ type: z.literal("url"), url: z.string().url().nullable() }),
    }),
});
const responseSchema = z.object({
    results: z.array(pageSchema),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    request_status: z.object({ incomplete_reason: z.string().nullish() }).optional(),
});

export interface NotionReader {
    listShopping(): Promise<ShoppingItem[]>;
}
export interface NotionWriter {
    setPurchased(input: SetPurchased): Promise<ShoppingItem>;
}
const statusOptionsSchema = z.object({
    object: z.literal("data_source"),
    id: z.string().uuid(),
    properties: z.object({
        Estado: z.object({
            type: z.literal("select"),
            select: z.object({
                options: z.array(z.object({ id: z.string().min(1), name: z.string() })),
            }),
        }),
    }),
});
const writablePageSchema = pageSchema.extend({
    parent: z.object({ type: z.literal("data_source_id"), data_source_id: z.string().uuid() }),
    in_trash: z.boolean(),
    archived: z.boolean().optional(),
    is_archived: z.boolean().optional(),
});
export class NotionClient implements NotionReader, NotionWriter {
    constructor(
        private readonly config: { token: string; dataSourceId: string },
        private readonly request: typeof fetch = fetch,
        private readonly pause = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ) {}

    async listShopping(): Promise<ShoppingItem[]> {
        const items: ShoppingItem[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
            const raw = await this.readPage(cursor);
            const parsed = responseSchema.safeParse(raw);
            if (!parsed.success) throw new NotionReadError("schema");
            const batch = parsed.data;
            if (batch.request_status?.incomplete_reason) throw new NotionReadError("pagination");
            items.push(...batch.results.map(toItem));
            if (!batch.has_more) return items;
            if (!batch.next_cursor || cursors.has(batch.next_cursor))
                throw new NotionReadError("pagination");
            cursor = batch.next_cursor;
            cursors.add(cursor);
        }
        throw new NotionReadError("pagination");
    }

    async setPurchased(input: SetPurchased): Promise<ShoppingItem> {
        const status = input.purchased ? "Comprado" : "En lista";
        const optionId = await this.statusOptionId(status);
        const current = await this.requestShoppingPage(input.id);
        if (current.status !== input.expectedStatus)
            throw new ShoppingWriteError("conflict", current);
        if (current.status === status) return current;
        // Notion has no conditional PATCH: compare just before writing. The service
        // serializes local operations; direct Notion edits can still race this request.
        try {
            const response = await this.requestNotion(`pages/${input.id}`, "PATCH", {
                properties: { Estado: { select: { id: optionId } } },
            });
            const updated = await this.parseShoppingPage(response, input.id, true);
            if (updated.status !== status) throw new ShoppingWriteError("uncertain");
            return updated;
        } catch (error) {
            if (!(error instanceof ShoppingWriteError) || error.reason !== "uncertain") throw error;
            // A lost response may have committed. Re-read once, never retry PATCH.
            let latest: ShoppingItem;
            try {
                latest = await this.requestShoppingPage(input.id);
            } catch {
                throw error;
            }
            if (latest.status === status) return latest;
            throw new ShoppingWriteError("uncertain", latest);
        }
    }

    private async statusOptionId(status: string): Promise<string> {
        const response = await this.requestNotion(
            `data_sources/${this.config.dataSourceId}`,
            "GET",
        );
        let raw: unknown;
        try {
            raw = await response.json();
        } catch {
            throw new ShoppingWriteError("schema");
        }
        const schema = statusOptionsSchema.safeParse(raw);
        if (
            !schema.success ||
            schema.data.id.toLowerCase() !== this.config.dataSourceId.toLowerCase()
        )
            throw new ShoppingWriteError("schema");
        const option = schema.data.properties.Estado.select.options.find(
            (option) => option.name === status,
        );
        if (!option) throw new ShoppingWriteError("schema");
        // Use the existing ID so a renamed option cannot silently extend the schema.
        return option.id;
    }

    private async requestShoppingPage(id: string): Promise<ShoppingItem> {
        return this.parseShoppingPage(await this.requestNotion(`pages/${id}`, "GET"), id, false);
    }

    private async requestNotion(
        path: string,
        method: "GET" | "PATCH",
        body?: unknown,
    ): Promise<Response> {
        let response: Response;
        try {
            response = await this.request(`https://api.notion.com/v1/${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${this.config.token}`,
                    "Content-Type": "application/json",
                    "Notion-Version": "2026-03-11",
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(10_000),
            });
        } catch {
            throw new ShoppingWriteError(method === "PATCH" ? "uncertain" : "unavailable");
        }
        // A failed/ambiguous PATCH is never retried automatically.
        if (response.status === 401 || response.status === 403)
            throw new ShoppingWriteError("forbidden");
        if (response.status === 404) throw new ShoppingWriteError("not_found");
        if (!response.ok)
            throw new ShoppingWriteError(
                method === "PATCH" && response.status >= 500 ? "uncertain" : "unavailable",
            );
        return response;
    }

    private async parseShoppingPage(
        response: Response,
        id: string,
        written: boolean,
    ): Promise<ShoppingItem> {
        let raw: unknown;
        try {
            raw = await response.json();
        } catch {
            throw new ShoppingWriteError(written ? "uncertain" : "unavailable");
        }
        const page = writablePageSchema.safeParse(raw);
        if (!page.success) throw new ShoppingWriteError(written ? "uncertain" : "unavailable");
        if (
            page.data.id.toLowerCase() !== id ||
            page.data.parent.data_source_id.toLowerCase() !==
                this.config.dataSourceId.toLowerCase() ||
            page.data.in_trash ||
            page.data.archived ||
            page.data.is_archived
        )
            throw new ShoppingWriteError(written ? "uncertain" : "not_found");
        const item = shoppingItemSchema.safeParse(toItem(page.data));
        if (!item.success) throw new ShoppingWriteError(written ? "uncertain" : "unavailable");
        return item.data;
    }

    private async readPage(cursor?: string): Promise<unknown> {
        for (let attempt = 0; attempt < 3; attempt++) {
            let response: Response;
            try {
                response = await this.request(
                    `https://api.notion.com/v1/data_sources/${this.config.dataSourceId}/query`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${this.config.token}`,
                            "Content-Type": "application/json",
                            "Notion-Version": "2026-03-11",
                        },
                        body: JSON.stringify({
                            page_size: 100,
                            ...(cursor ? { start_cursor: cursor } : {}),
                        }),
                        signal: AbortSignal.timeout(10_000),
                    },
                );
            } catch (cause) {
                if (attempt === 2) throw new NotionReadError("network", undefined, cause);
                await this.pause(500 * 2 ** attempt);
                continue;
            }
            if (response.ok) {
                try {
                    return await response.json();
                } catch {
                    throw new NotionReadError("schema");
                }
            }
            if ((response.status === 429 || response.status >= 500) && attempt < 2) {
                const retrySeconds = Number(response.headers.get("retry-after"));
                await this.pause(
                    Math.min(
                        10_000,
                        Math.max(
                            500 * 2 ** attempt,
                            Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0,
                        ),
                    ),
                );
                continue;
            }
            throw new NotionReadError("http", response.status);
        }
        throw new NotionReadError("network");
    }
}

function toItem({ id, url, properties: p }: z.infer<typeof pageSchema>): ShoppingItem {
    return {
        id,
        url,
        name: p.Nombre.title.map((t) => t.plain_text).join(""),
        room: p.Ambiente.select?.name ?? "Sin ambiente",
        priority: p.Prioridad.select?.name ?? "Por definir",
        status: p.Estado.select?.name ?? "Sin estado",
        origin: p.Origen.select?.name ?? "Sin definir",
        initialQuantity: p["Cantidad inicial"].rich_text.map((t) => t.plain_text).join(""),
        targetQuantity: p["Cantidad objetivo"].rich_text.map((t) => t.plain_text).join(""),
        quality: p["Calidad mínima"].rich_text.map((t) => t.plain_text).join(""),
        condition: p["Condición de compra"].rich_text.map((t) => t.plain_text).join(""),
        notes: p.Notas.rich_text.map((t) => t.plain_text).join(""),
        estimatedPriceArs: p["Precio estimado ARS"].number,
        reference: p.Referencia.url,
    };
}
