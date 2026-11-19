import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotionClient } from "../notion/notion.client.ts";
import { NotionReadError } from "../notion/notion.errors.ts";
import { ShoppingService } from "./shopping.service.ts";
import { SnapshotRepository } from "./snapshot.repository.ts";
import type { Snapshot } from "./shopping.schema.ts";

const dataSourceId = "00000000-0000-4000-8000-000000000902";
const config = { token: "test-token", dataSourceId };
function notionPage(id: string, name: string) {
    const text = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
    const select = (name: string) => ({ type: "select", select: { name } });
    return {
        object: "page",
        id,
        url: `https://www.notion.so/${id}`,
        properties: {
            Nombre: { type: "title", title: [{ plain_text: name }] },
            Ambiente: select("Cocina"),
            Prioridad: select("Esencial"),
            Estado: select("En lista"),
            Origen: select("Propuesto"),
            "Cantidad inicial": text("1"),
            "Cantidad objetivo": text("2"),
            "Calidad mínima": text("Durable"),
            "Condición de compra": text("Medir primero"),
            Notas: text(""),
            "Precio estimado ARS": { type: "number", number: null },
            Referencia: { type: "url", url: null },
        },
    };
}
const page1 = notionPage("00000000-0000-4000-8000-000000000903", "Cuchillo");
const page2 = notionPage("00000000-0000-4000-8000-000000000904", "Vasos");
const batch = (results: unknown[], next: string | null = null) => ({
    results,
    has_more: next !== null,
    next_cursor: next,
});
async function withRepository(
    run: (repository: SnapshotRepository, path: string) => Promise<void>,
) {
    const directory = await mkdtemp(join(tmpdir(), "home-shopping-"));
    try {
        await run(
            new SnapshotRepository(join(directory, "shopping.json"), dataSourceId),
            join(directory, "shopping.json"),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

describe("Notion shopping projection", () => {
    it("follows pagination and preserves missing prices and tentative decisions", async () => {
        const requests: Record<string, unknown>[] = [];
        const request: typeof fetch = async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            requests.push(body);
            return Response.json(body.start_cursor ? batch([page2]) : batch([page1], "next-page"));
        };
        const items = await new NotionClient(config, request).listShopping();
        expect(items.map((i) => i.name)).toEqual(["Cuchillo", "Vasos"]);
        expect(items[0]?.estimatedPriceArs).toBeNull();
        expect(items[0]?.origin).toBe("Propuesto");
        expect(requests[1]?.start_cursor).toBe("next-page");
    });
    it("retries a rate limit without dropping rows", async () => {
        let attempts = 0;
        const request: typeof fetch = async () =>
            ++attempts === 1
                ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
                : Response.json(batch([page1]));
        const items = await new NotionClient(config, request, async () => {}).listShopping();
        expect(items).toHaveLength(1);
        expect(attempts).toBe(2);
    });
    it("rejects renamed properties and repeated pagination cursors", async () => {
        const invalid = { ...page1, properties: { ...page1.properties, Nombre: undefined } };
        await expect(
            new NotionClient(config, async () => Response.json(batch([invalid]))).listShopping(),
        ).rejects.toMatchObject({ reason: "schema" });
        await expect(
            new NotionClient(config, async () =>
                Response.json(batch([page1], "loop")),
            ).listShopping(),
        ).rejects.toBeInstanceOf(NotionReadError);
    });
    it("persists a complete snapshot and retains it when a later read fails", async () =>
        withRepository(async (repository, path) => {
            let fail = false;
            let now = Date.parse("2026-11-12T05:00:00Z");
            const client = new NotionClient(config, async () =>
                fail ? new Response(null, { status: 403 }) : Response.json(batch([page1, page2])),
            );
            const service = new ShoppingService(
                { dataSourceId, intervalMs: 30_000 },
                repository,
                client,
                () => now,
            );
            await service.initialize();
            expect((await service.refresh()).state).toBe("live");
            const saved = await readFile(path, "utf8");
            fail = true;
            now += 31_000;
            const result = await service.refresh();
            expect(result.state).toBe("stale");
            expect(result.snapshot?.items).toHaveLength(2);
            expect(await readFile(path, "utf8")).toBe(saved);
            const offline = new ShoppingService(
                { dataSourceId, intervalMs: 30_000 },
                repository,
                null,
            );
            await offline.initialize();
            expect(offline.read().state).toBe("offline");
            expect(
                await new SnapshotRepository(path, "00000000-0000-4000-8000-000000000904").load(),
            ).toBeNull();
        }));
    it("coalesces concurrent refreshes and accepts a legitimately empty source", async () =>
        withRepository(async (repository) => {
            let requests = 0;
            const client = new NotionClient(config, async () => {
                requests++;
                return Response.json(batch([]));
            });
            const service = new ShoppingService(
                { dataSourceId, intervalMs: 30_000 },
                repository,
                client,
            );
            const results = await Promise.all([
                service.refresh(),
                service.refresh(),
                service.refresh(),
            ]);
            expect(requests).toBe(1);
            expect(results[0]?.snapshot?.items).toEqual([]);
            expect(results[0]?.state).toBe("live");
        }));
    it("does not publish a new projection if persistence fails", async () => {
        const old: Snapshot = {
            version: 1,
            dataSourceId,
            syncedAt: "2026-11-12T05:00:00Z",
            source: "api",
            items: [],
        };
        const repository = {
            load: async () => old,
            save: async () => {
                throw new Error("Disk full");
            },
        };
        const service = new ShoppingService(
            { dataSourceId, intervalMs: 30_000 },
            repository,
            new NotionClient(config, async () => Response.json(batch([page1]))),
        );
        await service.initialize();
        expect((await service.refresh()).snapshot).toEqual(old);
        expect(service.read().state).toBe("stale");
    });
});
