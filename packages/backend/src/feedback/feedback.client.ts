import { z } from "zod";
import { FeedbackError } from "./feedback.errors.ts";
import {
    feedbackEntrySchema,
    feedbackTargetSchema,
    type CreateFeedback,
    type FeedbackEntry,
} from "./feedback.schema.ts";

export interface FeedbackAdapter {
    list(): Promise<FeedbackEntry[]>;
    findOperation(operationId: string): Promise<FeedbackEntry | null>;
    getEntry(id: string): Promise<FeedbackEntry | null>;
    create(input: CreateFeedback, contextUrl: string): Promise<FeedbackEntry>;
}
const text = z.array(z.object({ plain_text: z.string() }));
const richText = z.object({ type: z.literal("rich_text"), rich_text: text });
const select = z.object({
    type: z.literal("select"),
    select: z.object({ name: z.string() }).nullable(),
});
const pageSchema = z.object({
    object: z.literal("page"),
    id: z.string().uuid(),
    created_time: z.string().datetime(),
    parent: z.object({ type: z.literal("data_source_id"), data_source_id: z.string().uuid() }),
    in_trash: z.literal(false),
    archived: z.literal(false).optional(),
    properties: z.object({
        Nombre: z.object({ type: z.literal("title"), title: text }),
        Tipo: select,
        Autor: select,
        Contenido: richText,
        "Tipo de destino": select,
        Destino: richText,
        Contexto: z.object({ type: z.literal("url"), url: z.string().url() }),
        Operación: richText,
    }),
});
const querySchema = z.object({
    results: z.array(pageSchema),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    request_status: z.object({ incomplete_reason: z.string().nullish() }).optional(),
});
const propertySchema = z.object({
    id: z.string().min(1),
    type: z.string(),
    select: z
        .object({ options: z.array(z.object({ id: z.string().min(1), name: z.string() })) })
        .optional(),
});
const sourceSchema = z.object({
    object: z.literal("data_source"),
    id: z.string().uuid(),
    properties: z.record(z.string(), propertySchema),
});

export class NotionFeedbackClient implements FeedbackAdapter {
    constructor(
        private readonly config: { token: string; dataSourceId: string },
        private readonly request: typeof fetch = fetch,
        private readonly pause = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ) {}
    list(): Promise<FeedbackEntry[]> {
        return this.query();
    }
    async findOperation(operationId: string): Promise<FeedbackEntry | null> {
        const entries = await this.query({
            property: "Operación",
            rich_text: { equals: operationId },
        });
        if (entries.length > 1) throw new FeedbackError("schema");
        return entries[0] ?? null;
    }
    async getEntry(id: string): Promise<FeedbackEntry | null> {
        const response = await this.requestNotion(`pages/${id}`, "GET");
        if (response.status === 404) return null;
        if (!response.ok) throw new FeedbackError("unavailable");
        const raw: unknown = await response.json();
        const identity = z
            .object({
                id: z.string().uuid(),
                parent: z.object({
                    type: z.literal("data_source_id"),
                    data_source_id: z.string().uuid(),
                }),
                in_trash: z.boolean(),
                archived: z.boolean().optional(),
            })
            .safeParse(raw);
        if (
            !identity.success ||
            identity.data.id !== id ||
            identity.data.parent.data_source_id !== this.config.dataSourceId
        )
            throw new FeedbackError("schema");
        if (identity.data.in_trash || identity.data.archived) return null;
        return this.toEntry(pageSchema.parse(raw));
    }
    async create(input: CreateFeedback, contextUrl: string): Promise<FeedbackEntry> {
        const raw = await this.read(`data_sources/${this.config.dataSourceId}`, "GET");
        const source = sourceSchema.safeParse(raw);
        if (
            !source.success ||
            source.data.id.toLowerCase() !== this.config.dataSourceId.toLowerCase()
        )
            throw new FeedbackError("schema");
        const props = source.data.properties;
        const required = {
            Nombre: "title",
            Tipo: "select",
            Autor: "select",
            Contenido: "rich_text",
            "Tipo de destino": "select",
            Destino: "rich_text",
            Contexto: "url",
            Operación: "rich_text",
        };
        for (const [name, type] of Object.entries(required))
            if (props[name]?.type !== type) throw new FeedbackError("schema");
        const option = (name: string, value: string) => {
            const id = props[name]?.select?.options.find((item) => item.name === value)?.id;
            if (!id) throw new FeedbackError("schema");
            return { id };
        };
        // Existing IDs prevent a renamed option/property from silently extending the schema.
        const properties = {
            [props.Nombre!.id]: { title: toRichText(input.title || "Comentario") },
            [props.Tipo!.id]: {
                select: option("Tipo", input.kind === "comment" ? "Comentario" : "Nota"),
            },
            [props.Autor!.id]: { select: option("Autor", input.displayAuthor) },
            [props.Contenido!.id]: { rich_text: toRichText(input.body) },
            [props["Tipo de destino"]!.id]: {
                select: input.target ? option("Tipo de destino", input.target.kind) : null,
            },
            [props.Destino!.id]: { rich_text: toRichText(input.target?.id ?? "") },
            [props.Contexto!.id]: { url: contextUrl },
            [props["Operación"]!.id]: { rich_text: toRichText(input.operationId) },
        };
        let response: Response;
        try {
            response = await this.requestNotion("pages", "POST", {
                parent: { type: "data_source_id", data_source_id: this.config.dataSourceId },
                properties,
            });
        } catch {
            throw new FeedbackError("uncertain");
        }
        if (!response.ok)
            throw new FeedbackError(
                [400, 401, 403, 404, 429].includes(response.status) ? "rejected" : "uncertain",
            );
        try {
            const entry = this.toEntry(pageSchema.parse(await response.json()));
            if (
                entry.operationId !== input.operationId ||
                entry.body !== input.body ||
                entry.displayAuthor !== input.displayAuthor ||
                entry.kind !== input.kind ||
                JSON.stringify(entry.target) !== JSON.stringify(input.target)
            )
                throw new FeedbackError("uncertain");
            return entry;
        } catch {
            throw new FeedbackError("uncertain");
        }
    }

    private async query(filter?: unknown): Promise<FeedbackEntry[]> {
        const entries: FeedbackEntry[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
            const raw = await this.read(`data_sources/${this.config.dataSourceId}/query`, "POST", {
                page_size: 100,
                ...(cursor ? { start_cursor: cursor } : {}),
                ...(filter ? { filter } : {}),
            });
            const parsed = querySchema.safeParse(raw);
            if (!parsed.success || parsed.data.request_status?.incomplete_reason)
                throw new FeedbackError("schema");
            entries.push(...parsed.data.results.map((entry) => this.toEntry(entry)));
            if (!parsed.data.has_more) {
                if (
                    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
                    new Set(entries.map((entry) => entry.operationId)).size !== entries.length
                )
                    throw new FeedbackError("schema");
                return entries.sort(
                    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
                );
            }
            if (!parsed.data.next_cursor || cursors.has(parsed.data.next_cursor))
                throw new FeedbackError("schema");
            cursor = parsed.data.next_cursor;
            cursors.add(cursor);
        }
        throw new FeedbackError("schema");
    }
    private toEntry(page: z.infer<typeof pageSchema>): FeedbackEntry {
        if (page.parent.data_source_id.toLowerCase() !== this.config.dataSourceId.toLowerCase())
            throw new FeedbackError("schema");
        const p = page.properties;
        const value = (parts: z.infer<typeof text>) =>
            parts.map((part) => part.plain_text).join("");
        const targetKind = p["Tipo de destino"].select?.name;
        const targetId = value(p.Destino.rich_text);
        if (Boolean(targetKind) !== Boolean(targetId)) throw new FeedbackError("schema");
        const kind =
            p.Tipo.select?.name === "Comentario"
                ? "comment"
                : p.Tipo.select?.name === "Nota"
                  ? "note"
                  : null;
        const target = targetKind
            ? feedbackTargetSchema.parse({ kind: targetKind, id: targetId })
            : null;
        if ((kind === "comment" && !target) || (kind === "note" && target))
            throw new FeedbackError("schema");
        return feedbackEntrySchema.parse({
            id: page.id,
            operationId: value(p["Operación"].rich_text),
            kind,
            displayAuthor: p.Autor.select?.name,
            title: value(p.Nombre.title),
            body: value(p.Contenido.rich_text),
            target,
            contextUrl: p.Contexto.url,
            createdAt: page.created_time,
        });
    }
    private async read(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
        for (let attempt = 0; attempt < 3; attempt++) {
            let response: Response;
            try {
                response = await this.requestNotion(path, method, body);
            } catch {
                if (attempt < 2) {
                    await this.pause(350 * (attempt + 1));
                    continue;
                }
                throw new FeedbackError("unavailable");
            }
            if (response.ok) {
                try {
                    return await response.json();
                } catch {
                    throw new FeedbackError("schema");
                }
            }
            if ((response.status === 429 || response.status >= 500) && attempt < 2) {
                const seconds = Number(response.headers.get("retry-after"));
                await this.pause(
                    Number.isFinite(seconds) && seconds > 0
                        ? Math.min(seconds * 1000, 60_000)
                        : 350 * (attempt + 1),
                );
                continue;
            }
            throw new FeedbackError(response.status === 400 ? "schema" : "unavailable");
        }
        throw new FeedbackError("unavailable");
    }
    private requestNotion(path: string, method: "GET" | "POST", body?: unknown): Promise<Response> {
        return this.request(`https://api.notion.com/v1/${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.config.token}`,
                "Content-Type": "application/json",
                "Notion-Version": "2026-03-11",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15_000),
        });
    }
}
function toRichText(value: string) {
    const parts: { type: "text"; text: { content: string } }[] = [];
    for (let start = 0; start < value.length;) {
        let end = Math.min(start + 1800, value.length);
        // Keep a surrogate pair together when splitting long notes for Notion.
        if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
        parts.push({ type: "text", text: { content: value.slice(start, end) } });
        start = end;
    }
    return parts;
}
