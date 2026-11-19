import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { ContentRepository, type ContentStore } from "./content.repository.ts";
import { ContentService } from "./content.service.ts";
import { NotionContentReader } from "./notion-content.reader.ts";
import { contentSnapshotSchema, safeContentLink, type ContentSnapshot } from "./content.schema.ts";
import { NotionRequestQueue } from "../notion/notion.transport.ts";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const rootId = id(1),
    shoppingSourceId = id(2),
    outsideId = id(3),
    feedbackSourceId = id(4),
    catalogSourceId = id(5);
function text(value: string, href: string | null = null) {
    return {
        plain_text: value,
        href,
        annotations: {
            bold: false,
            italic: false,
            code: false,
            strikethrough: false,
            underline: false,
        },
    };
}
function notionFixture() {
    const pages = new Map<string, unknown>();
    const children = new Map<string, unknown[]>();
    const databases = new Map<string, unknown>();
    let sequence = 100;
    const block = (type: string, payload: unknown, has_children = false) => ({
        object: "block",
        id: id(sequence++),
        type,
        [type]: payload,
        has_children,
    });
    const page = (pageId: string, title: string, parentId?: string) => ({
        object: "page",
        id: pageId,
        properties: { title: { type: "title", title: [text(title)] } },
        ...(parentId ? { parent: { type: "page_id", page_id: parentId } } : {}),
    });
    pages.set(rootId, page(rootId, "Home de ejemplo"));
    const rootBlocks: unknown[] = [
        block("heading_1", { rich_text: [text("Plan del hogar")] }),
        block("table_of_contents", {}),
        block("paragraph", {
            rich_text: [
                text(
                    "Referencia externa",
                    `https://www.notion.so/${outsideId.replaceAll("-", "")}`,
                ),
            ],
        }),
        block("image", {
            type: "file",
            file: {
                url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/private?X-Amz-Signature=secret",
            },
        }),
    ];
    let tableIndex = 0;
    for (let documentIndex = 0; documentIndex < 6; documentIndex++) {
        const child = block("child_page", { title: `Documento ${documentIndex + 1}` }, true);
        pages.set(child.id, page(child.id, `Documento ${documentIndex + 1}`, rootId));
        rootBlocks.push(child);
        const content: unknown[] = [
            block("callout", { rich_text: [text("Una condición de ejemplo")] }),
        ];
        const count = documentIndex < 4 ? 5 : 4;
        for (let tableNumber = 0; tableNumber < count; tableNumber++) {
            const table = block(
                "table",
                { table_width: 2, has_column_header: true, has_row_header: false },
                true,
            );
            const rows = tableIndex === 0 ? 101 : tableIndex === 1 ? 18 : 7;
            children.set(
                table.id,
                Array.from({ length: rows }, (_, row) =>
                    block("table_row", {
                        cells: [[text(`Objeto ${row}`)], [text("Condición comprobable")]],
                    }),
                ),
            );
            content.push(table);
            tableIndex++;
        }
        children.set(child.id, content);
    }
    for (const sourceId of [
        shoppingSourceId,
        shoppingSourceId,
        feedbackSourceId,
        catalogSourceId,
        outsideId,
    ]) {
        const database = block("child_database", { title: "Base de ejemplo" });
        rootBlocks.push(database);
        databases.set(database.id, { data_sources: [{ id: sourceId }] });
    }
    children.set(rootId, rootBlocks);
    const calls: string[] = [];
    const request: typeof fetch = vi.fn(async (input) => {
        const url = new URL(String(input));
        calls.push(url.pathname + url.search);
        const [, , kind, target, operation] = url.pathname.split("/");
        if (kind === "pages" && pages.has(target!)) return Response.json(pages.get(target!));
        if (kind === "databases" && databases.has(target!))
            return Response.json(databases.get(target!));
        if (kind === "blocks" && operation === "children" && children.has(target!)) {
            const rows = children.get(target!)!;
            const offset = Number(url.searchParams.get("start_cursor") ?? 0);
            const end = offset + 100;
            return Response.json({
                results: rows.slice(offset, end),
                has_more: end < rows.length,
                next_cursor: end < rows.length ? String(end) : null,
            });
        }
        return Response.json({ message: "not available" }, { status: 404 });
    });
    const reader = new NotionContentReader(
        {
            token: "synthetic-token",
            rootPageId: rootId,
            shoppingDataSourceId: shoppingSourceId,
            feedbackDataSourceId: feedbackSourceId,
            productReferencesDataSourceId: catalogSourceId,
        },
        request,
    );
    return { pages, children, calls, request, reader };
}

it("reads all six Home documents and 301 table rows, paginates tables and deduplicates database aliases", async () => {
    const fixture = notionFixture();
    const documents = await fixture.reader.readDocuments();
    expect(documents).toHaveLength(7);
    const tables = documents.flatMap((document) =>
        document.blocks.filter((block) => block.type === "table"),
    );
    expect(tables).toHaveLength(28);
    expect(tables.reduce((total, table) => total + table.children.length, 0)).toBe(301);
    expect(fixture.calls.some((path) => path.endsWith("start_cursor=100"))).toBe(true);
    expect(documents[0]!.blocks.filter((block) => block.type === "shopping")).toHaveLength(1);
    expect(documents[0]!.blocks.filter((block) => block.type === "feedback")).toHaveLength(1);
    expect(documents[0]!.blocks.filter((block) => block.type === "catalog")).toEqual([
        expect.objectContaining({
            text: [expect.objectContaining({ text: "Referencias de productos" })],
            targetId: catalogSourceId,
        }),
    ]);
    expect(fixture.calls.some((path) => path.includes(outsideId))).toBe(false);
    expect(JSON.stringify(documents)).not.toContain("X-Amz");
    expect(JSON.stringify(documents)).not.toContain("synthetic-token");
});

it("rejects a child page that moved outside Home instead of importing it", async () => {
    const fixture = notionFixture();
    const childId = [...fixture.pages.keys()][1]!;
    const child = fixture.pages.get(childId) as { parent: { page_id: string } };
    child.parent.page_id = outsideId;
    await expect(fixture.reader.readDocuments()).rejects.toThrow("Page left");
});

it("rejects incomplete and repeated pagination without replacing last complete content", async () => {
    const fixture = notionFixture();
    const good = await fixture.reader.readDocuments();
    let now = Date.parse("2026-11-16T12:00:00Z");
    let saved: ContentSnapshot | null = null;
    const store: ContentStore = {
        load: async () => saved,
        save: async (snapshot) => {
            saved = snapshot;
        },
    };
    const service = new ContentService(
        { rootPageId: rootId, intervalMs: 300_000 },
        store,
        { readDocuments: async () => good },
        () => now,
    );
    await service.refresh();
    const broken: typeof fetch = async (input) =>
        String(input).includes("/children")
            ? Response.json({ results: [], has_more: true, next_cursor: "repeated" })
            : fixture.request(input);
    const reader = new NotionContentReader(
        { token: "test", rootPageId: rootId, shoppingDataSourceId: shoppingSourceId },
        broken,
    );
    const stale = new ContentService(
        { rootPageId: rootId, intervalMs: 300_000 },
        store,
        reader,
        () => now,
    );
    await stale.initialize();
    now += 300_000;
    await stale.refresh();
    expect(stale.readIndex()).toMatchObject({ state: "stale", documents: expect.any(Array) });
    expect(stale.readIndex().documents).toHaveLength(7);
    expect(stale.readDocument(outsideId).document).toBeNull();
    expect(stale.hasDocument(outsideId)).toBe(false);
    expect(saved!.syncedAt).toBe("2026-11-16T12:00:00.000Z");
});

it("retains a complete projection on cache failure and makes document text searchable", async () => {
    const documents = await notionFixture().reader.readDocuments();
    const snapshot: ContentSnapshot = {
        version: 1,
        rootPageId: rootId,
        syncedAt: "2026-11-16T12:00:00Z",
        documents,
    };
    const service = new ContentService(
        { rootPageId: rootId, intervalMs: 300_000 },
        {
            load: async () => snapshot,
            save: async () => {
                throw new Error("disk full");
            },
        },
        {
            readDocuments: async () =>
                documents.map((document) => ({ ...document, title: "Changed title" })),
        },
    );
    await service.initialize();
    await service.refresh();
    expect(service.readIndex().state).toBe("stale");
    expect(service.readIndex().documents[1]!.searchText).toContain("Condición comprobable");
    expect(service.hasDocument(documents[1]!.id)).toBe(true);
});

it("persists private snapshots atomically and cannot load another Home root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-content-"));
    try {
        const path = join(directory, "content.json");
        const store = new ContentRepository(path, rootId);
        expect(await store.load()).toBeNull();
        const snapshot: ContentSnapshot = {
            version: 1,
            rootPageId: rootId,
            syncedAt: "2026-11-16T12:00:00Z",
            documents: await notionFixture().reader.readDocuments(),
        };
        await store.save(snapshot);
        expect(await store.load()).toEqual(snapshot);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await new ContentRepository(path, outsideId).load()).toBeNull();
        expect(
            contentSnapshotSchema.safeParse(JSON.parse(await readFile(path, "utf8"))).success,
        ).toBe(true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it.each([
    "javascript:alert(1)",
    "https://user:password@example.com",
    "https://example.com/?X-Amz-Signature=secret",
    "https://prod-files-secure.s3.us-west-2.amazonaws.com/file",
])("does not publish unsafe or signed link %s", (url) => {
    expect(safeContentLink(url)).toBeNull();
});

it("serializes adapters and respects Retry-After without replaying any request", async () => {
    let now = 0;
    const times: number[] = [];
    const request: typeof fetch = vi.fn(async () => {
        times.push(now);
        return new Response("{}", {
            status: times.length === 1 ? 429 : 200,
            headers: times.length === 1 ? { "retry-after": "2" } : {},
        });
    });
    const queue = new NotionRequestQueue(
        request,
        async (ms) => {
            now += ms;
        },
        () => now,
        350,
    );
    const responses = await Promise.all([
        queue.fetch("https://example.com/one"),
        queue.fetch("https://example.com/two", { method: "POST" }),
        queue.fetch("https://example.com/three"),
    ]);
    expect(times).toEqual([0, 2000, 2350]);
    expect(responses.map((response) => response.status)).toEqual([429, 200, 200]);
    expect(request).toHaveBeenCalledTimes(3);
});
