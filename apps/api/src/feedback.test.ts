import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
    buildRouter,
    FeedbackService,
    ShoppingService,
    type CreateFeedback,
    type FeedbackEntry,
    type FeedbackJournal,
    type FeedbackSnapshot,
} from "@repo/backend";
import { createApp } from "./app.ts";
import { createTestAuth, testPasswords } from "./auth/test-fixture.ts";

const origin = "https://home.example.test";
const source = "00000000-0000-4000-8000-000000000001";
const sharedDocument = "00000000-0000-4000-8000-000000000002";
const myGear = "00000000-0000-4000-8000-000000000905";
const input: CreateFeedback = {
    operationId: "00000000-0000-4000-8000-000000000003",
    kind: "comment",
    displayAuthor: "Persona B",
    title: "",
    body: "Medir antes de elegir.",
    target: { kind: "document", id: sharedDocument },
};
async function fixture() {
    let snapshot: FeedbackSnapshot | null = null;
    let journal: FeedbackJournal | null = null;
    const remote: FeedbackEntry[] = [];
    const create = vi.fn(async (value: CreateFeedback, contextUrl: string) => {
        const entry = {
            ...value,
            id: randomUUID(),
            title: value.title || "Comentario",
            contextUrl,
            createdAt: new Date().toISOString(),
        };
        remote.push(entry);
        return entry;
    });
    const feedback = new FeedbackService(
        { dataSourceId: source, origin, intervalMs: 300_000 },
        {
            loadSnapshot: async () => snapshot,
            saveSnapshot: async (next) => {
                snapshot = next;
            },
            loadJournal: async () => journal,
            saveJournal: async (next) => {
                journal = next;
            },
        },
        {
            list: async () => structuredClone(remote),
            findOperation: async (id) => remote.find((entry) => entry.operationId === id) ?? null,
            getEntry: async (id) => remote.find((entry) => entry.id === id) ?? null,
            create,
        },
        (target) =>
            target.kind === "document" && target.id === sharedDocument
                ? `/documentos/${sharedDocument}`
                : null,
    );
    await feedback.initialize();
    await feedback.refresh();
    const shopping = new ShoppingService(
        { dataSourceId: source, intervalMs: 300_000 },
        { load: async () => null, save: async () => {} },
        null,
    );
    const auth = createTestAuth();
    const app = createApp(shopping, origin, null, undefined, null, { auth, feedback });
    const login = await app.request(`${origin}/auth/login`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "home", password: testPasswords.home }),
    });
    const { session } = (await login.json()) as { session: { csrfToken: string } };
    const headers = {
        Cookie: login.headers.get("set-cookie")!.split(";")[0]!,
        Origin: origin,
        "x-csrf-token": session.csrfToken as string,
        "Content-Type": "application/json",
    };
    const save = (value = input, override = headers) =>
        app.request(`${origin}/trpc/feedback.create`, {
            method: "POST",
            headers: override,
            body: JSON.stringify({ json: value }),
        });
    const list = (target: CreateFeedback["target"], override = headers) =>
        app.request(
            `${origin}/trpc/feedback.list?input=${encodeURIComponent(JSON.stringify({ json: { target } }))}`,
            { headers: override },
        );
    return {
        app,
        headers,
        create,
        save,
        list,
        router: buildRouter(shopping, null, null, { feedback }),
    };
}

it("requires a real session, exact origin and CSRF before feedback requests reach Notion", async () => {
    const f = await fixture();
    expect((await f.save(input, { ...f.headers, Cookie: "" })).status).toBe(401);
    expect((await f.list(input.target, { ...f.headers, Cookie: "" })).status).toBe(401);
    expect((await f.save(input, { ...f.headers, "x-csrf-token": "" })).status).toBe(403);
    expect((await f.save(input, { ...f.headers, Origin: "https://outside.example" })).status).toBe(
        403,
    );
    expect(f.create).not.toHaveBeenCalled();
    const caller = f.router.createCaller({ session: null });
    await expect(caller.feedback.list({ target: null })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
    });
    await expect(caller.feedback.create(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("lets the shared role add comments with a self-selected author and rejects purchase writes", async () => {
    const f = await fixture();
    const response = await f.save();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
        result: {
            data: {
                json: {
                    status: "saved",
                    entry: {
                        displayAuthor: "Persona B",
                        body: input.body,
                        contextUrl: `${origin}/documentos/${sharedDocument}`,
                    },
                },
            },
        },
    });
    expect((await f.save()).status).toBe(200);
    expect(f.create).toHaveBeenCalledTimes(1);
    const list = await f.list(input.target);
    expect(await list.json()).toMatchObject({
        result: {
            data: {
                json: {
                    snapshot: { entries: [expect.objectContaining({ body: input.body })] },
                },
            },
        },
    });
    const purchase = await f.app.request(`${origin}/trpc/shopping.setPurchased`, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
            json: { id: sharedDocument, purchased: true, expectedStatus: "En lista" },
        }),
    });
    expect(purchase.status).toBe(403);
});

it("rejects excluded inventory, unknown notes and spoofed fields; supports standalone note discussions", async () => {
    const f = await fixture();
    for (const target of [
        { kind: "document" as const, id: myGear },
        { kind: "note" as const, id: myGear },
    ]) {
        expect((await f.save({ ...input, target })).status).toBe(404);
        expect((await f.list(target)).status).toBe(404);
    }
    expect((await f.save({ ...input, role: "owner" } as CreateFeedback)).status).toBe(400);
    expect(f.create).not.toHaveBeenCalled();
    const note = { ...input, kind: "note" as const, title: "Medidas de entrada", target: null };
    const response = await f.save(note);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
        result: { data: { json: { entry: FeedbackEntry } } };
    };
    const entry = body.result.data.json.entry;
    const comment = {
        ...input,
        operationId: randomUUID(),
        target: { kind: "note" as const, id: entry.id },
    };
    expect((await f.save(comment)).status).toBe(200);
    expect(f.create).toHaveBeenLastCalledWith(comment, `${origin}/notas#nota-${entry.id}`);
});
