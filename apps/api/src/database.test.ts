import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
    bootstrapHousehold,
    HomeStore,
    importHome,
    importBundleSchema,
    migrateDatabase,
    type CreateFeedback,
} from "@repo/backend";
import { createApp } from "./app.ts";
import { AuthenticationService } from "./auth/auth.service.ts";
import { testHashes, testPasswords, verifyTestPassword } from "./auth/test-fixture.ts";
import {
    bootstrap,
    databaseFixture,
    documentId,
    homeId,
    itemId,
    origin,
    otherHomeId,
} from "./database.fixture.ts";

const shopping = JSON.parse(
    await readFile(new URL("../../../examples/shopping.json", import.meta.url), "utf8"),
);
const collection = JSON.parse(
    await readFile(new URL("../../../examples/home-collection.json", import.meta.url), "utf8"),
);
const content = {
    version: 1,
    rootPageId: documentId,
    syncedAt: "2026-01-01T00:00:00.000Z",
    documents: [
        {
            id: documentId,
            parentId: null,
            title: "Synthetic document",
            url: "https://example.com/document",
            blocks: [],
        },
    ],
};
let f: Awaited<ReturnType<typeof databaseFixture>>;
beforeEach(async () => {
    f = await databaseFixture();
});
afterEach(async () => {
    await f?.close();
});
const note = (body = "Synthetic note"): CreateFeedback => ({
    operationId: randomUUID(),
    kind: "note",
    title: "Test note",
    body,
    target: null,
    displayAuthor: "Persona A",
});

it("applies migrations and bootstrap repeatedly without resetting accounts or duplicating records", async () => {
    const another = f.open();
    await Promise.all([migrateDatabase(f.db, f.schema), migrateDatabase(another.db, f.schema)]);
    await bootstrapHousehold(f.db, bootstrap);
    expect(
        (await f.db.$client.query("SELECT count(*)::int AS count FROM users")).rows[0].count,
    ).toBe(3);
    await expect(
        bootstrapHousehold(f.db, {
            ...bootstrap,
            accounts: [{ ...bootstrap.accounts[0]!, passwordHash: testHashes.home }],
        }),
    ).rejects.toThrow("differs");
    expect((await f.store.findAccount("owner"))?.passwordHash).toBe(testHashes.owner);
    await expect(bootstrapHousehold(f.db, { ...bootstrap, id: randomUUID() })).rejects.toThrow();
    expect(
        (await f.db.$client.query("SELECT count(*)::int AS count FROM households")).rows[0].count,
    ).toBe(2);
});

it("imports validated records atomically, preserves null prices, quantities and links, and leaves later edits intact", async () => {
    const bundle = { shopping, collection, content };
    expect(await importHome(f.db, homeId, bundle)).toMatchObject({
        shopping: 4,
        collection: 4,
        documents: 1,
    });
    const item = (await f.store.dashboard(f.owner)).snapshot!.items.find(
        (entry) => entry.id === itemId,
    )!;
    expect(item).toEqual({ ...shopping.items[0], version: 0 });
    await f.store.setPurchased(f.owner, {
        id: itemId,
        purchased: true,
        expectedStatus: "En lista",
        expectedVersion: 0,
    });
    expect(await importHome(f.db, homeId, bundle)).toEqual({
        shopping: 0,
        collection: 0,
        documents: 0,
        references: 0,
        feedback: 0,
    });
    expect(
        (await f.store.dashboard(f.owner)).snapshot!.items.find((entry) => entry.id === itemId),
    ).toMatchObject({ status: "Comprado", version: 1 });
    expect((await f.store.collection(f.owner))?.entries).toEqual(collection.entries);
    expect((await f.store.document(f.owner, documentId)).document).toEqual(content.documents[0]);
    expect(
        importBundleSchema.safeParse({
            shopping: { ...shopping, items: [shopping.items[0], shopping.items[0]] },
        }).success,
    ).toBe(false);
    const invalid = {
        shopping: {
            ...shopping,
            items: [
                { ...shopping.items[0], id: randomUUID() },
                { ...shopping.items[1], id: randomUUID(), estimatedPriceArs: 1e20 },
            ],
        },
    };
    // The second insert exceeds PostgreSQL numeric precision; the first insert must roll back too.
    await expect(importHome(f.db, homeId, invalid)).rejects.toThrow();
    expect((await f.store.dashboard(f.owner)).snapshot!.items).toHaveLength(4);
});

it("rolls back separately valid imports that would violate the retained catalog relationships", async () => {
    await importHome(f.db, homeId, { collection });
    const second = {
        ...collection,
        entries: [{ ...collection.entries[0], id: "different-reference" }],
    };
    expect(importBundleSchema.safeParse({ collection: second }).success).toBe(true);
    await expect(importHome(f.db, homeId, { shopping, collection: second })).rejects.toThrow(
        "Multiple references",
    );
    expect((await f.store.collection(f.owner))?.entries).toEqual(collection.entries);
    expect((await f.store.dashboard(f.owner)).snapshot!.items).toHaveLength(0);
    // The uniqueness rule is household-scoped, not global.
    expect(await importHome(f.db, otherHomeId, { collection: second })).toMatchObject({
        collection: 1,
    });
});

it("retains each reference collection's provenance across additive imports and retries", async () => {
    const atlas = {
        version: 1,
        importedAt: "2026-01-01T00:00:00.000Z",
        status: "exploratory",
        source: {
            title: "Atlas example",
            url: "https://example.com/atlas",
            conversation: null,
            sha256: "a".repeat(64),
        },
        references: [
            {
                id: "aaaaaaaaaaaaaa",
                title: "Example",
                projectKey: "https://example.com",
                source: "https://example.com",
                publisher: "Example",
                styles: [],
                rooms: [],
                objects: [],
                note: "",
                quality: "editorial",
                palette: [],
                hero: false,
                image: null,
                thumbnail: null,
            },
        ],
    };
    const collectionMetadata = {
        id: "pinterest",
        title: "Second example",
        url: "https://example.com/second",
        importedAt: "2026-02-01T00:00:00.000Z",
    };
    const second = {
        ...atlas,
        importedAt: collectionMetadata.importedAt,
        collections: [collectionMetadata],
        references: [{ ...atlas.references[0], id: "bbbbbbbbbbbbbb", collection: "pinterest" }],
    };
    await importHome(f.db, homeId, { moodboard: atlas });
    expect(await importHome(f.db, homeId, { moodboard: second })).toMatchObject({ references: 1 });
    expect(await importHome(f.db, homeId, { moodboard: second })).toMatchObject({ references: 0 });
    const saved = await f.store.moodboard(f.owner);
    expect(saved?.references).toHaveLength(2);
    expect(saved?.collections).toEqual([
        {
            id: "atlas",
            title: atlas.source.title,
            url: atlas.source.url,
            importedAt: atlas.importedAt,
        },
        collectionMetadata,
    ]);
});

it("retains committed purchases and feedback when all application connections are replaced", async () => {
    await importHome(f.db, homeId, { shopping });
    await f.store.setPurchased(f.owner, {
        id: itemId,
        purchased: true,
        expectedStatus: "En lista",
        expectedVersion: 0,
    });
    const saved = await f.store.createFeedback(f.shared, note());
    await f.disconnect();
    const replacement = new HomeStore(f.open().db, origin);
    expect(
        (await replacement.dashboard(f.owner)).snapshot!.items.find((entry) => entry.id === itemId),
    ).toMatchObject({ status: "Comprado", version: 1 });
    expect((await replacement.listFeedback(f.shared, null)).snapshot!.entries).toEqual([
        saved.entry,
    ]);
    expect(await replacement.findAccount("owner")).not.toBeNull();
});

it("arbitrates concurrent purchases across independent pools and rejects stale versions after an ABA change", async () => {
    await importHome(f.db, homeId, { shopping });
    const otherProcess = new HomeStore(f.open().db, origin);
    const input = { id: itemId, purchased: true, expectedStatus: "En lista", expectedVersion: 0 };
    const results = await Promise.allSettled([
        f.store.setPurchased(f.owner, input),
        otherProcess.setPurchased(f.owner, input),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
        reason: { reason: "conflict" },
    });
    await f.store.setPurchased(f.owner, {
        ...input,
        purchased: false,
        expectedStatus: "Comprado",
        expectedVersion: 1,
    });
    await expect(otherProcess.setPurchased(f.owner, input)).rejects.toMatchObject({
        reason: "conflict",
    });
});

it("deduplicates concurrent feedback retries durably and rejects changed payloads or another author", async () => {
    const input = note();
    const otherProcess = new HomeStore(f.open().db, origin);
    const [first, retry] = await Promise.all([
        f.store.createFeedback(f.shared, input),
        otherProcess.createFeedback(f.shared, input),
    ]);
    expect(first).toEqual(retry);
    await expect(
        f.store.createFeedback(f.shared, { ...input, body: "Changed" }),
    ).rejects.toMatchObject({ reason: "conflict" });
    await expect(f.store.createFeedback(f.owner, input)).rejects.toMatchObject({
        reason: "conflict",
    });
    expect((await f.store.listFeedback(f.shared, null)).snapshot!.entries).toHaveLength(1);
});

it("scopes all collections and writes to the authenticated household, including matching IDs", async () => {
    await importHome(f.db, homeId, { shopping, collection, content });
    expect((await f.store.dashboard(f.other)).snapshot!.items).toEqual([]);
    expect(await f.store.collection(f.other)).toBeNull();
    expect(await f.store.moodboard(f.other)).toBeNull();
    expect((await f.store.contentIndex(f.other)).documents).toEqual([]);
    await expect(f.store.document(f.other, documentId)).rejects.toMatchObject({
        reason: "not_found",
    });
    const input = { id: itemId, purchased: true, expectedStatus: "En lista", expectedVersion: 0 };
    await expect(f.store.setPurchased(f.other, input)).rejects.toMatchObject({
        reason: "not_found",
    });
    await expect(f.store.setPurchased({ ...f.shared, role: "owner" }, input)).rejects.toMatchObject(
        { reason: "forbidden" },
    );
    await expect(f.store.dashboard({ ...f.owner, householdId: otherHomeId })).rejects.toMatchObject(
        { reason: "forbidden" },
    );
    for (const target of [
        { kind: "shopping", id: itemId },
        { kind: "document", id: documentId },
        { kind: "collection", id: "example-1" },
    ] as const) {
        await expect(f.store.listFeedback(f.other, target)).rejects.toMatchObject({
            reason: "not_found",
        });
        await expect(
            f.store.createFeedback(f.other, { ...note(), kind: "comment", target }),
        ).rejects.toMatchObject({ reason: "not_found" });
    }
    await importHome(f.db, otherHomeId, { shopping });
    await f.store.setPurchased(f.other, input);
    expect(
        (await f.store.dashboard(f.owner)).snapshot!.items.find((item) => item.id === itemId)
            ?.status,
    ).toBe("En lista");
});

async function login(app: ReturnType<typeof createApp>, username: string) {
    const response = await app.request(`${origin}/auth/login`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
            username,
            password: username === "home" ? testPasswords.home : testPasswords.owner,
        }),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { session: { csrfToken: string } };
    expect(JSON.stringify(json)).not.toMatch(/passwordHash|householdId|userId/);
    return {
        Cookie: response.headers.get("set-cookie")!.split(";")[0]!,
        Origin: origin,
        "x-csrf-token": json.session.csrfToken,
        "Content-Type": "application/json",
    };
}
function post(
    app: ReturnType<typeof createApp>,
    headers: Record<string, string>,
    path: string,
    input: unknown,
) {
    return app.request(`${origin}/trpc/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ json: input }),
    });
}

it("persists HTTP writes and returns 409 for stale purchases while rejecting forged scope fields", async () => {
    await importHome(f.db, homeId, { shopping });
    const app = createApp(
        f.store,
        origin,
        new AuthenticationService(f.store, Date.now, verifyTestPassword),
    );
    const headers = await login(app, "owner");
    const input = { id: itemId, purchased: true, expectedStatus: "En lista", expectedVersion: 0 };
    expect((await post(app, headers, "shopping.setPurchased", input)).status).toBe(200);
    expect((await post(app, headers, "shopping.setPurchased", input)).status).toBe(409);
    expect(
        (await post(app, headers, "shopping.setPurchased", { ...input, householdId: otherHomeId }))
            .status,
    ).toBe(400);
    const other = await login(app, "other");
    expect(
        (
            await post(
                app,
                { ...other, "X-Household-Id": homeId, "X-User-Role": "owner" },
                "shopping.setPurchased",
                input,
            )
        ).status,
    ).toBe(404);
    const shared = await login(app, "home");
    expect((await post(app, shared, "shopping.setPurchased", input)).status).toBe(403);
    const draft = note();
    expect((await post(app, shared, "feedback.create", draft)).status).toBe(200);
    expect((await post(app, shared, "feedback.create", draft)).status).toBe(200);
    expect((await f.store.listFeedback(f.shared, null)).snapshot!.entries).toHaveLength(1);
});

it("honors current roles, membership revocation and password rotation on existing HTTP sessions", async () => {
    await importHome(f.db, homeId, { shopping });
    const app = createApp(
        f.store,
        origin,
        new AuthenticationService(f.store, Date.now, verifyTestPassword),
    );
    const owner = await login(app, "owner");
    await f.db.$client.query("UPDATE memberships SET role = 'commenter' WHERE user_id = $1", [
        f.owner.userId,
    ]);
    expect(
        (
            await post(app, owner, "shopping.setPurchased", {
                id: itemId,
                purchased: true,
                expectedStatus: "En lista",
                expectedVersion: 0,
            })
        ).status,
    ).toBe(403);
    await f.db.$client.query("DELETE FROM memberships WHERE user_id = $1", [f.owner.userId]);
    expect(
        (await app.request(`${origin}/trpc/shopping.dashboard`, { headers: owner })).status,
    ).toBe(401);
    const shared = await login(app, "home");
    await f.db.$client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        testHashes.owner,
        f.shared.userId,
    ]);
    expect(
        (await app.request(`${origin}/trpc/shopping.dashboard`, { headers: shared })).status,
    ).toBe(401);
});

it("serves media only when referenced by the current home and masks database failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-postgres-test-"));
    try {
        const filename = "atlas-aaaaaaaaaaaaaa.jpg";
        await writeFile(join(directory, filename), "synthetic-image");
        const moodboard = {
            version: 1,
            importedAt: "2026-01-01T00:00:00.000Z",
            source: {
                title: "Synthetic",
                url: "https://example.com",
                conversation: null,
                sha256: "a".repeat(64),
            },
            status: "exploratory",
            references: [
                {
                    id: "aaaaaaaaaaaaaa",
                    title: "Synthetic reference",
                    projectKey: "https://example.com",
                    source: "https://example.com",
                    publisher: "Example",
                    styles: [],
                    rooms: [],
                    objects: [],
                    note: "",
                    quality: "editorial",
                    palette: [],
                    hero: false,
                    image: `/media/${filename}`,
                    thumbnail: null,
                },
            ],
        };
        await importHome(f.db, homeId, { moodboard });
        const app = createApp(
            f.store,
            origin,
            new AuthenticationService(f.store, Date.now, verifyTestPassword),
            directory,
        );
        const owner = await login(app, "owner");
        const other = await login(app, "other");
        expect((await app.request(`${origin}/media/${filename}`, { headers: owner })).status).toBe(
            200,
        );
        expect((await app.request(`${origin}/media/${filename}`, { headers: other })).status).toBe(
            404,
        );
        await f.disconnect();
        const failure = await app.request(`${origin}/trpc/shopping.dashboard`, { headers: owner });
        expect(failure.status).toBe(503);
        expect(await failure.text()).toBe('{"error":"No se pudo completar la operación."}');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
