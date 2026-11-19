import { expect, it, vi } from "vitest";
import { NotionFeedbackClient } from "./feedback.client.ts";
import type { CreateFeedback } from "./feedback.schema.ts";

const source = "00000000-0000-4000-8000-000000000001";
const operation = "00000000-0000-4000-8000-000000000003";
const input: CreateFeedback = {
    operationId: operation,
    kind: "note",
    title: "Medidas",
    body: "Revisar profundidad",
    displayAuthor: "Persona A",
    target: null,
};
const text = (value: string) => [{ plain_text: value }];
function page(id = "00000000-0000-4000-8000-000000000004", op = operation) {
    return {
        object: "page",
        id,
        created_time: "2026-11-16T12:00:00Z",
        in_trash: false,
        parent: { type: "data_source_id", data_source_id: source },
        properties: {
            Nombre: { type: "title", title: text(input.title) },
            Tipo: { type: "select", select: { name: "Nota" } },
            Autor: { type: "select", select: { name: "Persona A" } },
            Contenido: { type: "rich_text", rich_text: text(input.body) },
            "Tipo de destino": { type: "select", select: null },
            Destino: { type: "rich_text", rich_text: [] },
            Contexto: { type: "url", url: "https://home.example/notas" },
            Operación: { type: "rich_text", rich_text: text(op) },
        },
    };
}
function sourceSchema() {
    return {
        object: "data_source",
        id: source,
        properties: {
            Nombre: { id: "title-id", type: "title" },
            Tipo: {
                id: "kind-id",
                type: "select",
                select: {
                    options: [
                        { id: "kind-note", name: "Nota" },
                        { id: "kind-comment", name: "Comentario" },
                    ],
                },
            },
            Autor: {
                id: "author-id",
                type: "select",
                select: {
                    options: [
                        { id: "author-person-a", name: "Persona A" },
                        { id: "author-person-b", name: "Persona B" },
                    ],
                },
            },
            Contenido: { id: "body-id", type: "rich_text" },
            "Tipo de destino": { id: "target-kind-id", type: "select", select: { options: [] } },
            Destino: { id: "target-id", type: "rich_text" },
            Contexto: { id: "url-id", type: "url" },
            Operación: { id: "operation-id", type: "rich_text" },
        },
    };
}
const queryResponse = (results: unknown[], more = false, cursor: string | null = null) =>
    Response.json({ results, has_more: more, next_cursor: cursor });
const client = (request: typeof fetch, pause = vi.fn(async (_ms: number) => {})) =>
    new NotionFeedbackClient({ token: "test-only-secret", dataSourceId: source }, request, pause);

it("reads every page and rejects duplicate records, repeated cursors and incomplete queries", async () => {
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(queryResponse([page()], true, "page-two"))
        .mockResolvedValueOnce(
            queryResponse([
                page(
                    "00000000-0000-4000-8000-000000000005",
                    "00000000-0000-4000-8000-000000000006",
                ),
            ]),
        );
    expect(await client(request).list()).toHaveLength(2);
    expect(JSON.parse(String(request.mock.calls[1]![1]!.body)).start_cursor).toBe("page-two");
    const duplicate = vi.fn<typeof fetch>().mockResolvedValue(queryResponse([page(), page()]));
    await expect(client(duplicate).list()).rejects.toMatchObject({ reason: "schema" });
    const loop = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => queryResponse([], true, "same"));
    await expect(client(loop).list()).rejects.toMatchObject({ reason: "schema" });
    expect(loop).toHaveBeenCalledTimes(2);
    const incomplete = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
            results: [],
            has_more: false,
            next_cursor: null,
            request_status: { incomplete_reason: "query_result_limit_reached" },
        }),
    );
    await expect(client(incomplete).list()).rejects.toMatchObject({ reason: "schema" });
});
it("queries reconciliation by the operation property and refuses mismatched parent sources", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(queryResponse([page()]));
    expect((await client(request).findOperation(operation))?.operationId).toBe(operation);
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).filter).toEqual({
        property: "Operación",
        rich_text: { equals: operation },
    });
    const foreign = page();
    foreign.parent.data_source_id = operation;
    await expect(
        client(vi.fn<typeof fetch>().mockResolvedValue(queryResponse([foreign]))).list(),
    ).rejects.toMatchObject({ reason: "schema" });
});
it("writes once using existing property/option IDs and preserves multiline text", async () => {
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(sourceSchema()))
        .mockResolvedValueOnce(Response.json(page()));
    expect((await client(request).create(input, "https://home.example/notas")).body).toBe(
        input.body,
    );
    const body = JSON.parse(String(request.mock.calls[1]![1]!.body));
    expect(body.parent).toEqual({ type: "data_source_id", data_source_id: source });
    expect(body.properties["kind-id"]).toEqual({ select: { id: "kind-note" } });
    expect(body.properties["author-id"]).toEqual({ select: { id: "author-person-a" } });
    expect(body.properties["body-id"].rich_text[0].text.content).toBe(input.body);
    expect(request.mock.calls[1]![1]!.headers).toMatchObject({ "Notion-Version": "2026-03-11" });
});
it("stops before mutation on schema drift instead of creating new select options", async () => {
    const schema = sourceSchema();
    schema.properties.Autor.select.options = [];
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(schema));
    await expect(client(request).create(input, "https://home.example/notas")).rejects.toMatchObject(
        { reason: "schema" },
    );
    expect(request).toHaveBeenCalledTimes(1);
});
it.each([503, 500, 409])("never retries an ambiguous create response (%s)", async (status) => {
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(sourceSchema()))
        .mockResolvedValueOnce(new Response("upstream detail must not escape", { status }));
    await expect(client(request).create(input, "https://home.example/notas")).rejects.toMatchObject(
        { reason: "uncertain" },
    );
    expect(request).toHaveBeenCalledTimes(2);
});
it.each([400, 401, 403, 404, 429])(
    "distinguishes a definite refusal (%s) without automatic write retries",
    async (status) => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json(sourceSchema()))
            .mockResolvedValueOnce(new Response("private upstream message", { status }));
        await expect(
            client(request).create(input, "https://home.example/notas"),
        ).rejects.toMatchObject({ reason: "rejected" });
        expect(request).toHaveBeenCalledTimes(2);
    },
);
it("retries rate-limited reads using Retry-After", async () => {
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } }))
        .mockResolvedValueOnce(queryResponse([]));
    const pause = vi.fn(async (_ms: number) => {});
    expect(await client(request, pause).list()).toEqual([]);
    expect(pause).toHaveBeenCalledWith(2000);
});

it("preserves emoji across long rich-text boundaries without sending broken Unicode", async () => {
    const body = `${"a".repeat(1799)}🪑\n${"b".repeat(1800)}`;
    const result = page();
    result.properties.Contenido.rich_text = text(body);
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(sourceSchema()))
        .mockResolvedValueOnce(Response.json(result));
    expect(
        (await client(request).create({ ...input, body }, "https://home.example/notas")).body,
    ).toBe(body);
    const sent = JSON.parse(String(request.mock.calls[1]![1]!.body));
    const segments = sent.properties["body-id"].rich_text.map(
        (part: { text: { content: string } }) => part.text.content,
    ) as string[];
    expect(segments.join("")).toBe(body);
    expect(segments.every((part) => part.length <= 1800 && part.isWellFormed())).toBe(true);
});
