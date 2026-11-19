import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
    ShoppingService,
    SnapshotRepository,
    CollectionService,
    CollectionRepository,
    type MoodboardSnapshot,
} from "@repo/backend";
import { createAuthenticatedTestApp } from "./auth/test-fixture.ts";

it("serves a typed dashboard, blocks foreign origins/hosts and exposes health without secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-http-"));
    try {
        const source = "00000000-0000-4000-8000-000000000902";
        const service = new ShoppingService(
            { dataSourceId: source, intervalMs: 300_000 },
            new SnapshotRepository(join(directory, "snapshot.json"), source),
            null,
        );
        await service.initialize();
        const app = await createAuthenticatedTestApp(service, "http://localhost:5173");
        const health = await app.request("http://localhost/health");
        expect(await health.json()).toEqual({ status: "ok" });
        const dashboard = await app.request("http://localhost/trpc/shopping.dashboard", {
            headers: { Host: "localhost:5173" },
        });
        expect(dashboard.status).toBe(200);
        expect(await dashboard.json()).toMatchObject({
            result: {
                data: { json: { state: "unconfigured", snapshot: null, configured: false } },
            },
        });
        expect(dashboard.headers.get("cache-control")).toBe("no-store");
        const missingMoodboard = await app.request("http://localhost/trpc/moodboard", {
            headers: { Host: "localhost:5173" },
        });
        expect(await missingMoodboard.json()).toMatchObject({ result: { data: { json: null } } });
        for (const origin of ["https://untrusted.example", "null"]) {
            const response = await app.request("http://localhost/trpc/shopping.refresh", {
                method: "POST",
                headers: {
                    Host: "localhost:5173",
                    Origin: origin,
                    "Content-Type": "application/json",
                },
                body: "{}",
            });
            expect(response.status).toBe(403);
        }
        const noOrigin = await app.request("http://localhost/trpc/shopping.refresh", {
            method: "POST",
            headers: { Host: "localhost:5173" },
        });
        expect(noOrigin.status).toBe(403);
        const badHost = await app.request("http://localhost/trpc/shopping.dashboard", {
            headers: { Host: "untrusted.example" },
        });
        expect(badHost.status).toBe(403);
        const refresh = await app.request("http://localhost/trpc/shopping.refresh", {
            method: "POST",
            headers: {
                Host: "localhost:5173",
                Origin: "http://localhost:5173",
                "Content-Type": "application/json",
            },
            body: "{}",
        });
        expect(refresh.status).toBe(200);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("serves an exploratory moodboard independently of shopping sync through the protected HTTP boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-moodboard-http-"));
    try {
        const source = "00000000-0000-4000-8000-000000000902";
        const service = new ShoppingService(
            { dataSourceId: source, intervalMs: 300_000 },
            new SnapshotRepository(join(directory, "snapshot.json"), source),
            null,
        );
        const moodboard: MoodboardSnapshot = {
            version: 1,
            importedAt: "2026-11-12T14:00:00.000Z",
            source: {
                title: "Test atlas",
                url: "https://example.com/atlas",
                conversation: "https://example.com/chat",
                sha256: "a".repeat(64),
            },
            status: "exploratory",
            references: [
                {
                    id: "a123456789abcd",
                    title: "An unselected reference",
                    projectKey: "https://example.com/project",
                    source: "https://example.com/project",
                    publisher: "Publisher",
                    styles: ["Direction"],
                    rooms: [],
                    objects: [],
                    note: "Curator's note",
                    quality: "editorial",
                    palette: ["#112233"],
                    hero: true,
                    image: "/media/atlas-a123456789abcd.jpg",
                    thumbnail: null,
                },
            ],
        };
        const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
        await writeFile(join(directory, "atlas-a123456789abcd.jpg"), image);
        const app = await createAuthenticatedTestApp(
            service,
            "http://localhost:5173",
            null,
            directory,
            moodboard,
        );
        const response = await app.request("http://localhost/trpc/moodboard", {
            headers: { Host: "localhost:5173" },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({ result: { data: { json: moodboard } } });
        const photo = await app.request("http://localhost/media/atlas-a123456789abcd.jpg");
        expect(photo.headers.get("content-type")).toBe("image/jpeg");
        expect(photo.headers.get("cache-control")).toBe("no-store");
        expect(Buffer.from(await photo.arrayBuffer())).toEqual(image);
        for (const path of ["/trpc/moodboard", "/media/atlas-a123456789abcd.jpg"])
            expect(
                (
                    await app.request(`http://localhost${path}`, {
                        headers: { Host: "untrusted.example" },
                    })
                ).status,
            ).toBe(403);
        expect(
            (
                await app.request("http://localhost/trpc/moodboard", {
                    headers: { Host: "localhost:5173", Origin: "https://untrusted.example" },
                })
            ).status,
        ).toBe(403);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("serves only local image files and returns collection provenance through tRPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-media-"));
    try {
        const source = "00000000-0000-4000-8000-000000000902";
        const service = new ShoppingService(
            { dataSourceId: source, intervalMs: 300_000 },
            new SnapshotRepository(join(directory, "snapshot.json"), source),
            null,
        );
        const collection = {
            version: 1 as const,
            source: "import" as const,
            importedAt: "2026-11-12T11:21:08.000Z",
            entries: [],
        };
        const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP8sAAAAASUVORK5CYII=",
            "base64",
        );
        await writeFile(join(directory, "object.png"), png);
        await writeFile(join(directory, "private.json"), '{"private":true}');
        const app = await createAuthenticatedTestApp(
            service,
            "http://localhost:5173",
            collection,
            directory,
        );
        const image = await app.request("http://localhost/media/object.png");
        expect(image.status).toBe(200);
        expect(image.headers.get("content-type")).toBe("image/png");
        expect(image.headers.get("cache-control")).toBe("no-store");
        expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
        for (const path of ["private.json", "missing.png", "%2e%2e%2fprivate.json"]) {
            expect((await app.request(`http://localhost/media/${path}`)).status).toBe(404);
        }
        const response = await app.request("http://localhost/trpc/collection", {
            headers: { Host: "localhost:5173" },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            result: { data: { json: { ...collection, version: 2 } } },
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("serves new catalog generations and independent stale status through the authenticated HTTP boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-http-"));
    try {
        const path = join(directory, "catalog.json");
        const collection = new CollectionService(new CollectionRepository(path));
        const service = new ShoppingService(
            { dataSourceId: "00000000-0000-4000-8000-000000000001", intervalMs: 300_000 },
            { load: async () => null, save: async () => {} },
            null,
        );
        const app = await createAuthenticatedTestApp(service, "http://localhost:5173", collection);
        const get = async (procedure: string) => {
            const response = await app.request(`http://localhost/trpc/${procedure}`);
            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toBe("no-store");
            return ((await response.json()) as { result: { data: { json: unknown } } }).result.data
                .json;
        };
        expect(await get("collection")).toBeNull();
        const first = {
            version: 2,
            source: "import",
            importedAt: "2026-11-18T10:00:00.000Z",
            entries: [],
        };
        await writeFile(path, JSON.stringify(first));
        expect(await get("collection")).toEqual(first);
        const second = { ...first, importedAt: "2026-11-18T11:00:00.000Z" };
        await writeFile(`${path}.next`, JSON.stringify(second));
        await rename(`${path}.next`, path);
        expect(await get("collection")).toEqual(second);
        await writeFile(path, "{incomplete");
        expect(await get("collection")).toEqual(second);
        expect(await get("collectionStatus")).toMatchObject({
            state: "stale",
            importedAt: second.importedAt,
        });
        expect(await get("shopping.dashboard")).toMatchObject({
            state: "unconfigured",
            snapshot: null,
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
