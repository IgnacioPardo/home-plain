import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { ContentSnapshot } from "@repo/backend";
import type { Environment } from "./env.ts";
import { start } from "./server.ts";
import { testHashes } from "./auth/test-fixture.ts";

const fixture = vi.hoisted(() => ({
    shopping: vi.fn(),
    documents: vi.fn(),
    feedback: vi.fn(),
    fetch: null as ((request: Request) => Response | Promise<Response>) | null,
    environment: null as Environment | null,
}));
vi.mock("./env.ts", () => ({ readEnvironment: () => fixture.environment }));
vi.mock("./auth/password.ts", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./auth/password.ts")>()),
    verifyPassword: async (password: string) => password === "synthetic-startup-password",
}));
vi.mock("@hono/node-server", () => ({
    serve: ({ fetch }: { fetch: typeof fixture.fetch }) => {
        fixture.fetch = fetch;
        return { close: (done: () => void) => done() };
    },
}));
vi.mock("@repo/backend", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@repo/backend")>()),
    NotionClient: class {
        listShopping = fixture.shopping;
    },
    NotionContentReader: class {
        readDocuments = fixture.documents;
    },
    NotionFeedbackClient: class {
        list = fixture.feedback;
    },
}));

const home = "00000000-0000-4000-8000-000000000001";
const snapshot: ContentSnapshot = {
    version: 1,
    rootPageId: home,
    syncedAt: "2020-01-01T00:00:00Z",
    documents: [
        {
            id: home,
            parentId: null,
            title: "Cached Home",
            url: "https://www.notion.so/example",
            blocks: [],
        },
    ],
};
const directories: string[] = [];
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
    await stop?.();
    stop = undefined;
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
});

it.each([true, false])(
    "serves cached/loading content before initial Notion requests finish (cache: %s)",
    async (cached) => {
        const directory = await mkdtemp(join(tmpdir(), "home-startup-"));
        directories.push(directory);
        fixture.environment = {
            NODE_ENV: "test",
            AUTH_SHARED_USERNAME: "home",
            AUTH_SHARED_PASSWORD_HASH: testHashes.home,
            AUTH_OWNER_USERNAME: "owner",
            AUTH_OWNER_PASSWORD_HASH: testHashes.owner,
            HOST: "127.0.0.1",
            PORT: 3210,
            APP_ORIGIN: "http://localhost:3210",
            NOTION_API_TOKEN: "synthetic",
            NOTION_HOME_PAGE_ID: home,
            NOTION_SHOPPING_DATA_SOURCE_ID: home,
            NOTION_SYNC_INTERVAL_SECONDS: 300,
            NOTION_CACHE_FILE: join(directory, "shopping.json"),
            HOME_CONTENT_FILE: join(directory, "content.json"),
            NOTION_FEEDBACK_DATA_SOURCE_ID: home,
            NOTION_FEEDBACK_CACHE_FILE: join(directory, "feedback.json"),
            NOTION_FEEDBACK_JOURNAL_FILE: join(directory, "receipts.json"),
            HOME_COLLECTION_FILE: join(directory, "collection.json"),
            HOME_MOODBOARD_FILE: join(directory, "moodboard.json"),
            HOME_MEDIA_DIRECTORY: join(directory, "media"),
            STATIC_ROOT: undefined,
        };
        if (cached)
            await writeFile(fixture.environment.HOME_CONTENT_FILE, JSON.stringify(snapshot));
        if (cached)
            await writeFile(
                fixture.environment.NOTION_FEEDBACK_CACHE_FILE,
                JSON.stringify({
                    version: 1,
                    dataSourceId: home,
                    syncedAt: snapshot.syncedAt,
                    entries: [],
                }),
            );
        let rejectFeedback!: (reason: Error) => void;
        fixture.feedback.mockReturnValue(
            new Promise((_, reject) => {
                rejectFeedback = reject;
            }),
        );
        let rejectShopping!: (reason: Error) => void;
        let rejectDocuments!: (reason: Error) => void;
        fixture.shopping.mockReturnValue(
            new Promise((_, reject) => {
                rejectShopping = reject;
            }),
        );
        fixture.documents.mockReturnValue(
            new Promise((_, reject) => {
                rejectDocuments = reject;
            }),
        );
        stop = await start();
        expect(fixture.shopping).toHaveBeenCalled();
        expect(fixture.documents).toHaveBeenCalled();
        expect(fixture.feedback).toHaveBeenCalled();
        const anonymous = await fixture.fetch!(
            new Request("http://localhost:3210/trpc/content.index"),
        );
        expect(anonymous.status).toBe(401);
        const login = await fixture.fetch!(
            new Request("http://localhost:3210/auth/login", {
                method: "POST",
                headers: { Origin: "http://localhost:3210", "Content-Type": "application/json" },
                body: JSON.stringify({ username: "home", password: "synthetic-startup-password" }),
            }),
        );
        expect(login.status).toBe(200);
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        const request = async (path: string) => {
            const response = await fixture.fetch!(
                new Request(`http://localhost:3210${path}`, {
                    headers: { Host: "localhost:3210", Cookie: cookie },
                }),
            );
            expect(response.status).toBe(200);
            return response.json();
        };
        expect(await request("/health")).toEqual({ status: "ok" });
        expect(await request("/trpc/content.index")).toMatchObject({
            result: {
                data: {
                    json: {
                        state: cached ? "stale" : "syncing",
                        documents: cached ? [{ title: "Cached Home" }] : [],
                    },
                },
            },
        });
        expect(await request("/trpc/shopping.dashboard")).toMatchObject({
            result: { data: { json: { state: "syncing" } } },
        });
        const feedbackPath = `/trpc/feedback.list?input=${encodeURIComponent(JSON.stringify({ json: { target: null } }))}`;
        expect(await request(feedbackPath)).toMatchObject({
            result: {
                data: {
                    json: {
                        state: cached ? "stale" : "syncing",
                        canCreate: cached,
                        snapshot: cached ? { entries: [] } : null,
                    },
                },
            },
        });
        rejectFeedback(new Error("Notion unavailable"));
        rejectShopping(new Error("Notion unavailable"));
        rejectDocuments(new Error("Notion unavailable"));
        await vi.waitFor(async () => {
            expect(await request("/trpc/content.index")).toMatchObject({
                result: {
                    data: {
                        json: {
                            state: cached ? "stale" : "error",
                            documents: cached ? [{ title: "Cached Home" }] : [],
                        },
                    },
                },
            });
            expect(await request(feedbackPath)).toMatchObject({
                result: {
                    data: {
                        json: {
                            state: cached ? "stale" : "error",
                        },
                    },
                },
            });
            expect(await request("/trpc/shopping.dashboard")).toMatchObject({
                result: { data: { json: { state: "error" } } },
            });
        });
    },
);
