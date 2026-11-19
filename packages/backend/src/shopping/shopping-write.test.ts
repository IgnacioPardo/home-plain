import { describe, expect, it, vi } from "vitest";
import { NotionClient } from "../notion/notion.client.ts";
import { ShoppingService } from "./shopping.service.ts";
import type { ShoppingItem, Snapshot } from "./shopping.schema.ts";

const source = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const input = { id, purchased: true, expectedStatus: "En lista" };
const config = { token: "private-test-token", dataSourceId: source };
const options = {
    object: "data_source",
    id: source,
    properties: {
        Estado: {
            type: "select",
            select: {
                options: [
                    { id: "pending", name: "En lista" },
                    { id: "bought", name: "Comprado" },
                ],
            },
        },
    },
};
const withSchema =
    (request: typeof fetch): typeof fetch =>
    (url, init) =>
        String(url).endsWith(`/data_sources/${source}`)
            ? Promise.resolve(Response.json(options))
            : request(url, init);
function page(status = "En lista", pageId = id) {
    const text = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
    const select = (name: string) => ({ type: "select", select: { name } });
    return {
        object: "page",
        id: pageId,
        url: "https://example.com/item",
        parent: { type: "data_source_id", data_source_id: source },
        in_trash: false,
        properties: {
            Nombre: { type: "title", title: [{ plain_text: "Objeto de prueba" }] },
            Ambiente: select("Cocina"),
            Prioridad: select("Esencial"),
            Estado: select(status),
            Origen: select("Condicionado"),
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
const batch = (pages: unknown[]) => ({ results: pages, has_more: false, next_cursor: null });
async function fixtureItems(): Promise<ShoppingItem[]> {
    return new NotionClient(config, async () =>
        Response.json(batch([page(), page("En lista", otherId)])),
    ).listShopping();
}
async function setup(request: typeof fetch, failSave = false) {
    const snapshot: Snapshot = {
        version: 1,
        dataSourceId: source,
        syncedAt: "2026-11-12T12:00:00.000Z",
        source: "api",
        items: await fixtureItems(),
    };
    const store = {
        load: async () => snapshot,
        save: vi.fn(async (_value: Snapshot) => {
            if (failSave) throw new Error("Disk full");
        }),
    };
    let now = Date.parse(snapshot.syncedAt);
    const service = new ShoppingService(
        { dataSourceId: source, intervalMs: 300_000 },
        store,
        new NotionClient(config, withSchema(request), async () => {}),
        () => now,
    );
    await service.initialize();
    return {
        service,
        store,
        snapshot,
        advance: () => {
            now += 16_000;
        },
    };
}

describe("Notion purchase writes", () => {
    it("reads membership and current status, changes only Estado and validates each confirmed response", async () => {
        let status = "En lista";
        const calls: { url: string; method: string; body: unknown }[] = [];
        const client = new NotionClient(
            config,
            withSchema(async (url, init) => {
                const body = init?.body ? JSON.parse(String(init.body)) : undefined;
                calls.push({ url: String(url), method: init?.method ?? "", body });
                if (init?.method === "PATCH")
                    status =
                        body.properties.Estado.select.id === "bought" ? "Comprado" : "En lista";
                return Response.json(page(status));
            }),
        );
        const checked = await client.setPurchased(input);
        expect(checked).toMatchObject({
            status: "Comprado",
            origin: "Condicionado",
            estimatedPriceArs: null,
        });
        expect(
            (await client.setPurchased({ ...input, purchased: false, expectedStatus: "Comprado" }))
                .status,
        ).toBe("En lista");
        expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH", "GET", "PATCH"]);
        expect(calls.every((c) => c.url === `https://api.notion.com/v1/pages/${id}`)).toBe(true);
        expect(calls[1]?.body).toEqual({
            properties: { Estado: { select: { id: "bought" } } },
        });
        expect(calls[3]?.body).toEqual({
            properties: { Estado: { select: { id: "pending" } } },
        });
    });
    it.each([
        { parent: { type: "data_source_id", data_source_id: otherId } },
        { in_trash: true },
        { archived: true },
        { is_archived: true },
        { id: otherId },
    ])("never patches an item outside the source or active list: %o", async (override) => {
        const request = vi.fn(async () => Response.json({ ...page(), ...override }));
        await expect(
            new NotionClient(config, withSchema(request)).setPurchased(input),
        ).rejects.toMatchObject({
            reason: "not_found",
        });
        expect(request).toHaveBeenCalledOnce();
    });
    it("rejects upstream status conflicts and schema drift before writing", async () => {
        const conflict = vi.fn(async () => Response.json(page("Depende del depto")));
        await expect(
            new NotionClient(config, withSchema(conflict)).setPurchased(input),
        ).rejects.toMatchObject({
            reason: "conflict",
            currentItem: { status: "Depende del depto" },
        });
        expect(conflict).toHaveBeenCalledOnce();
        const drift = vi.fn(async () => Response.json({ ...page(), properties: {} }));
        await expect(
            new NotionClient(config, withSchema(drift)).setPurchased(input),
        ).rejects.toMatchObject({
            reason: "unavailable",
        });
        expect(drift).toHaveBeenCalledOnce();
    });
    it.each([403, 429, 500])(
        "does not retry rejected writes (%s) or expose upstream bodies",
        async (status) => {
            const request = vi.fn(async (_url, init) =>
                init?.method === "GET"
                    ? Response.json(page())
                    : new Response("sensitive upstream response", { status }),
            );
            await expect(
                new NotionClient(config, withSchema(request)).setPurchased(input),
            ).rejects.toMatchObject({
                reason: status === 403 ? "forbidden" : status === 500 ? "uncertain" : "unavailable",
            });
            expect(request).toHaveBeenCalledTimes(status === 500 ? 3 : 2);
        },
    );
    it("does not retry a write after a lost response and does not claim an unvalidated response saved", async () => {
        const request = vi.fn(async (_url, init) => {
            if (init?.method === "GET") return Response.json(page());
            throw new Error("private-test-token");
        });
        await expect(
            new NotionClient(config, withSchema(request)).setPurchased(input),
        ).rejects.toMatchObject({
            reason: "uncertain",
        });
        expect(request).toHaveBeenCalledTimes(3);
        const invalid = vi.fn(async (_url, init) =>
            Response.json(init?.method === "GET" ? page() : { object: "page" }),
        );
        await expect(
            new NotionClient(config, withSchema(invalid)).setPurchased(input),
        ).rejects.toMatchObject({
            reason: "uncertain",
        });
        expect(invalid).toHaveBeenCalledTimes(3);
    });
});

it("rejects missing or renamed options rather than creating new Notion schema values", async () => {
    const request = vi.fn<typeof fetch>(async () =>
        Response.json({
            ...options,
            properties: {
                Estado: {
                    type: "select",
                    select: { options: [{ id: "pending", name: "En lista" }] },
                },
            },
        }),
    );
    await expect(new NotionClient(config, request).setPurchased(input)).rejects.toMatchObject({
        reason: "schema",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0]?.[0])).toBe(
        `https://api.notion.com/v1/data_sources/${source}`,
    );
});
it("confirms a committed write after the PATCH response was lost, without retrying the write", async () => {
    let status = "En lista";
    const request = vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method === "PATCH") {
            status = "Comprado";
            throw new Error("Lost response");
        }
        return Response.json(page(status));
    });
    const { service } = await setup(request, true);
    const result = await service.setPurchased(input);
    expect(result.snapshot?.items[0]?.status).toBe("Comprado");
    expect(result.issue).toBe("cache_unavailable");
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PATCH", "GET"]);
});
it("does not send another write while a previous uncertain outcome cannot be read", async () => {
    let reads = 0;
    const request = vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method === "GET" && ++reads === 1) return Response.json(page());
        throw new Error("Network unavailable");
    });
    const { service } = await setup(request);
    await expect(service.setPurchased(input)).rejects.toMatchObject({ reason: "uncertain" });
    await expect(service.setPurchased(input)).rejects.toMatchObject({ reason: "unavailable" });
    expect(request.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(service.read().state).toBe("stale");
});

describe("purchase projection coordination", () => {
    it("preserves a confirmed remote change if cache persistence fails without restamping unrelated data", async () => {
        const { service, snapshot } = await setup(
            async (_url, init) =>
                Response.json(page(init?.method === "PATCH" ? "Comprado" : "En lista")),
            true,
        );
        const result = await service.setPurchased(input);
        expect(result.state).toBe("stale");
        expect(result.issue).toBe("cache_unavailable");
        expect(result.snapshot?.items[0]?.status).toBe("Comprado");
        expect(result.snapshot?.items[1]).toEqual(snapshot.items[1]);
        expect(result.snapshot?.syncedAt).toBe(snapshot.syncedAt);
        expect(service.read()).toEqual(result);
    });
    it("rejects offline and unknown items without reaching Notion", async () => {
        const request = vi.fn(async () => Response.json(page()));
        const { service, store } = await setup(request);
        await expect(
            service.setPurchased({ ...input, id: "00000000-0000-4000-8000-000000000099" }),
        ).rejects.toMatchObject({ reason: "not_found" });
        expect(request).not.toHaveBeenCalled();
        const offline = new ShoppingService(
            { dataSourceId: source, intervalMs: 300_000 },
            store,
            null,
        );
        await offline.initialize();
        await expect(offline.setPurchased(input)).rejects.toMatchObject({ reason: "unconfigured" });
    });
    it("publishes an upstream conflict and allows immediate refresh despite the normal cooldown", async () => {
        let status = "En lista";
        const request = vi.fn(async (url) =>
            String(url).endsWith("/query")
                ? Response.json(batch([page(status)]))
                : Response.json(page(status)),
        );
        const { service } = await setup(request);
        await service.refresh();
        status = "Depende del depto";
        await expect(service.setPurchased(input)).rejects.toMatchObject({ reason: "conflict" });
        expect(service.read().snapshot?.items[0]?.status).toBe("Depende del depto");
        status = "Comprado";
        await service.refresh();
        expect(service.read().snapshot?.items[0]?.status).toBe("Comprado");
        expect(request).toHaveBeenCalledTimes(3);
    });
    it("lets an in-flight refresh finish before writing, then rejects a second stale write", async () => {
        let finishRead!: () => void;
        const reading = new Promise<void>((resolve) => {
            finishRead = resolve;
        });
        let startedRead!: () => void;
        const started = new Promise<void>((resolve) => {
            startedRead = resolve;
        });
        const methods: string[] = [];
        const { service } = await setup(async (url, init) => {
            if (String(url).endsWith("/query")) {
                methods.push("query");
                startedRead();
                await reading;
                return Response.json(batch([page()]));
            }
            methods.push(init!.method!);
            return Response.json(page(init?.method === "PATCH" ? "Comprado" : "En lista"));
        });
        const refresh = service.refresh();
        await started;
        const write = service.setPurchased(input);
        const conflict = service.setPurchased(input).catch((error) => error);
        expect(methods).toEqual(["query"]);
        finishRead();
        await refresh;
        expect((await write).snapshot?.items[0]?.status).toBe("Comprado");
        expect(await conflict).toMatchObject({ reason: "conflict" });
        expect(methods).toEqual(["query", "GET", "PATCH"]);
        expect(service.read().snapshot?.items[0]?.status).toBe("Comprado");
    });
    it("queues refresh behind a write so an older query cannot overwrite the confirmed status", async () => {
        let finishPatch!: () => void;
        const patching = new Promise<void>((resolve) => {
            finishPatch = resolve;
        });
        let startedPatch!: () => void;
        const started = new Promise<void>((resolve) => {
            startedPatch = resolve;
        });
        let status = "En lista";
        const methods: string[] = [];
        const { service } = await setup(async (url, init) => {
            if (String(url).endsWith("/query")) {
                methods.push("query");
                return Response.json(batch([page(status)]));
            }
            methods.push(init!.method!);
            if (init?.method === "PATCH") {
                startedPatch();
                await patching;
                status = "Comprado";
            }
            return Response.json(page(status));
        });
        const write = service.setPurchased(input);
        await started;
        const refresh = service.refresh();
        expect(methods).toEqual(["GET", "PATCH"]);
        finishPatch();
        await write;
        await refresh;
        expect(methods).toEqual(["GET", "PATCH", "query"]);
        expect(service.read().snapshot?.items[0]?.status).toBe("Comprado");
    });
});
