import { expect, it, vi } from "vitest";
import { NotionClient, ShoppingService, type Snapshot } from "@repo/backend";
import { createApp } from "./app.ts";
import { createAuthenticatedTestApp } from "./auth/test-fixture.ts";

const source = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const input = { id, purchased: true, expectedStatus: "En lista" };
const origin = "http://localhost:5173";
function page(status: string, parentSource = source) {
    const text = { type: "rich_text", rich_text: [] };
    const select = (name: string) => ({ type: "select", select: { name } });
    return {
        object: "page",
        id,
        url: "https://example.com/item",
        parent: { type: "data_source_id", data_source_id: parentSource },
        in_trash: false,
        properties: {
            Nombre: { type: "title", title: [{ plain_text: "Objeto de prueba" }] },
            Ambiente: select("Cocina"),
            Prioridad: select("Esencial"),
            Estado: select(status),
            Origen: select("Confirmado"),
            "Cantidad inicial": text,
            "Cantidad objetivo": text,
            "Calidad mínima": text,
            "Condición de compra": text,
            Notas: text,
            "Precio estimado ARS": { type: "number", number: null },
            Referencia: { type: "url", url: null },
        },
    };
}
async function setup() {
    let status = "En lista";
    let parentSource = source;
    let patchStatus = 200;
    let snapshot: Snapshot | null = null;
    const request = vi.fn<typeof fetch>(async (url, init) => {
        if (String(url).endsWith(`/data_sources/${source}`))
            return Response.json({
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
            });
        if (String(url).endsWith("/query"))
            return Response.json({ results: [page(status)], has_more: false, next_cursor: null });
        if (init?.method === "PATCH") {
            if (patchStatus !== 200)
                return new Response("private upstream detail", { status: patchStatus });
            status =
                JSON.parse(String(init.body)).properties.Estado.select.id === "bought"
                    ? "Comprado"
                    : "En lista";
        }
        return Response.json(page(status, parentSource));
    });
    const service = new ShoppingService(
        { dataSourceId: source, intervalMs: 300_000 },
        {
            load: async () => snapshot,
            save: async (next) => {
                snapshot = next;
            },
        },
        new NotionClient(
            { token: "private-test-token", dataSourceId: source },
            request,
            async () => {},
        ),
    );
    await service.initialize();
    await service.refresh();
    request.mockClear();
    const app = await createAuthenticatedTestApp(service, origin);
    return {
        app,
        request,
        setStatus: (value: string) => {
            status = value;
        },
        setParent: (value: string) => {
            parentSource = value;
        },
        rejectPatch: (value: number) => {
            patchStatus = value;
        },
    };
}
function save(
    app: ReturnType<typeof createApp>,
    value: unknown = input,
    headers: Record<string, string> = { Host: "localhost:5173", Origin: origin },
) {
    return app.request("http://localhost/trpc/shopping.setPurchased", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ json: value }),
    });
}
it("saves check/uncheck through the real HTTP, tRPC, service and Notion adapter boundary", async () => {
    const { app, request } = await setup();
    const checked = await save(app);
    expect(checked.status).toBe(200);
    expect(checked.headers.get("cache-control")).toBe("no-store");
    expect(await checked.json()).toMatchObject({
        result: {
            data: {
                json: {
                    snapshot: {
                        items: [
                            {
                                id,
                                status: "Comprado",
                                origin: "Confirmado",
                                estimatedPriceArs: null,
                            },
                        ],
                    },
                },
            },
        },
    });
    const unchecked = await save(app, { ...input, purchased: false, expectedStatus: "Comprado" });
    expect(unchecked.status).toBe(200);
    expect(await unchecked.json()).toMatchObject({
        result: { data: { json: { snapshot: { items: [{ id, status: "En lista" }] } } } },
    });
    const patch = request.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patch).toHaveLength(2);
    expect(JSON.parse(String(patch[0]?.[1]?.body))).toEqual({
        properties: { Estado: { select: { id: "bought" } } },
    });
});
it("rejects untrusted origins/hosts, absent origin and invalid input before any Notion request", async () => {
    const { app, request } = await setup();
    const deniedHeaders: Record<string, string>[] = [
        { Host: "localhost:5173", Origin: "https://untrusted.example" },
        { Host: "localhost:5173", Origin: "null" },
        { Host: "localhost:5173" },
        { Host: "untrusted.example", Origin: origin },
    ];
    for (const headers of deniedHeaders) expect((await save(app, input, headers)).status).toBe(403);
    for (const value of [
        { ...input, id: "not-an-id" },
        { ...input, purchased: "true" },
        { ...input, expectedStatus: 3 },
        { ...input, properties: { Origen: "Comprado" } },
        { ...input, expectedStatus: "x".repeat(201) },
    ])
        expect((await save(app, value)).status).toBe(400);
    expect((await save(app, { ...input, id: "00000000-0000-4000-8000-000000000099" })).status).toBe(
        404,
    );
    expect(request).not.toHaveBeenCalled();
});
it("rejects a moved page and an external status conflict without PATCH", async () => {
    const moved = await setup();
    moved.setParent("00000000-0000-4000-8000-000000000099");
    expect((await save(moved.app)).status).toBe(404);
    expect(moved.request.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET"]);
    const changed = await setup();
    changed.setStatus("Depende del depto");
    const conflict = await save(changed.app);
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).toContain("El estado cambió en Notion");
    expect(changed.request.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET"]);
    const dashboard = await changed.app.request("http://localhost/trpc/shopping.dashboard", {
        headers: { Host: "localhost:5173" },
    });
    expect(await dashboard.json()).toMatchObject({
        result: { data: { json: { snapshot: { items: [{ status: "Depende del depto" }] } } } },
    });
});
it("reports safe permission and ambiguous-write errors without leaking token or response bodies", async () => {
    for (const [upstream, expected] of [
        [403, 403],
        [500, 502],
    ]) {
        const { app, request, rejectPatch } = await setup();
        rejectPatch(upstream!);
        const response = await save(app);
        expect(response.status).toBe(expected);
        const body = await response.text();
        expect(body).not.toContain("private-test-token");
        expect(body).not.toContain("private upstream detail");
        expect(body).toContain(
            upstream === 403 ? "Notion no permite actualizar" : "No pudimos confirmar",
        );
        expect(request).toHaveBeenCalledTimes(upstream === 500 ? 4 : 3);
    }
});
it("rejects writes when no app integration is configured", async () => {
    const service = new ShoppingService(
        { dataSourceId: source, intervalMs: 300_000 },
        { load: async () => null, save: async () => {} },
        null,
    );
    const response = await save(await createAuthenticatedTestApp(service, origin));
    expect(response.status).toBe(412);
    expect(await response.text()).toContain("Conectá Notion");
});
