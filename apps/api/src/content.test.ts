import { expect, it } from "vitest";
import { buildRouter, ContentService, ShoppingService, type ContentSnapshot } from "@repo/backend";
import { createApp } from "./app.ts";
import { createTestAuth, testPasswords } from "./auth/test-fixture.ts";

it("serves only projected Home documents to authenticated shared and owner sessions", async () => {
    const origin = "https://home.example.test";
    const home = "00000000-0000-4000-8000-000000000001";
    const outside = "00000000-0000-4000-8000-000000000002";
    const snapshot: ContentSnapshot = {
        version: 1,
        rootPageId: home,
        syncedAt: "2026-11-16T12:00:00Z",
        documents: [
            {
                id: home,
                parentId: null,
                title: "Home",
                url: "https://www.notion.so/example",
                blocks: [],
            },
        ],
    };
    const content = new ContentService(
        { rootPageId: home, intervalMs: 300_000 },
        { load: async () => snapshot, save: async () => {} },
        null,
    );
    await content.initialize();
    const shopping = new ShoppingService(
        { dataSourceId: home, intervalMs: 300_000 },
        { load: async () => null, save: async () => {} },
        null,
    );
    const auth = createTestAuth();
    const app = createApp(shopping, origin, null, undefined, null, { content, auth });
    const documentPath = (id: string) =>
        `/trpc/content.document?input=${encodeURIComponent(JSON.stringify({ json: { id } }))}`;
    for (const path of ["/trpc/content.index", documentPath(home)]) {
        const anonymous = await app.request(`${origin}${path}`, {
            headers: { "X-User-Role": "owner" },
        });
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers.get("cache-control")).toBe("no-store");
        expect(await anonymous.text()).not.toContain(home);
    }
    // Authorization also holds at the domain router independently of HTTP middleware.
    const caller = buildRouter(shopping, null, null, { content }).createCaller({ session: null });
    await expect(caller.content.index()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.content.document({ id: home })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
    });
    for (const username of ["home", "owner"] as const) {
        const login = await app.request(`${origin}/auth/login`, {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: testPasswords[username] }),
        });
        expect(login.status).toBe(200);
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        const list = await app.request(`${origin}/trpc/content.index`, {
            headers: { Cookie: cookie },
        });
        expect(list.status).toBe(200);
        expect(list.headers.get("cache-control")).toBe("no-store");
        expect(await list.json()).toMatchObject({
            result: { data: { json: { state: "offline", documents: [{ id: home }] } } },
        });
        const get = (id: string) =>
            app.request(`${origin}${documentPath(id)}`, { headers: { Cookie: cookie } });
        expect((await get(home)).status).toBe(200);
        expect((await get(outside)).status).toBe(404);
        expect((await get("https://www.notion.so/private")).status).toBe(400);
        expect(
            (
                await app.request(`${origin}/trpc/content.index`, {
                    headers: { Cookie: cookie, Host: "foreign.example" },
                })
            ).status,
        ).toBe(403);
        auth.logout(cookie.split("=")[1]);
        expect((await get(home)).status).toBe(401);
    }
});
