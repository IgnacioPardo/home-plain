import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ShoppingService, authSessionSchema } from "@repo/backend";
import { createApp } from "../app.ts";
import { readEnvironment } from "../env.ts";
import { createTestAuth, testHashes, testPasswords } from "./test-fixture.ts";
import { AuthenticationService } from "./auth.service.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const origin = "https://home.example.test";
const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
});
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "home-auth-"));
    directories.push(directory);
    await writeFile(join(directory, "private.png"), "private-image-content");
    const service = new ShoppingService(
        { dataSourceId: "00000000-0000-4000-8000-000000000001", intervalMs: 300_000 },
        { load: async () => null, save: async () => {} },
        null,
    );
    let now = Date.now();
    const auth = createTestAuth(() => now);
    const app = createApp(service, origin, null, directory, null, { auth });
    return {
        app,
        auth,
        advance: (ms: number) => {
            now += ms;
        },
    };
}
async function login(
    app: ReturnType<typeof createApp>,
    username = "home",
    password = testPasswords[username as keyof typeof testPasswords],
) {
    return app.request(`${origin}/auth/login`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
}
async function signedIn(app: ReturnType<typeof createApp>, username = "home") {
    const response = await login(app, username);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const data = (await response.json()) as { session: unknown };
    const body = { session: authSessionSchema.parse(data.session) };
    return {
        response,
        body,
        headers: {
            Cookie: cookie,
            Origin: origin,
            "x-csrf-token": body.session.csrfToken as string,
        },
    };
}

it("denies private data and media to anonymous and forged-header requests", async () => {
    const { app } = await fixture();
    for (const path of [
        "/trpc/shopping.dashboard",
        "/trpc/collection",
        "/trpc/collectionStatus",
        "/trpc/moodboard",
        "/trpc/auth.session",
        "/media/private.png",
    ])
        for (const headers of [
            {},
            {
                "X-User-Role": "owner",
                "Cf-Access-Authenticated-User-Email": "owner@example.test",
                Cookie: "__Host-home-session=fake",
            },
        ]) {
            const response = await app.request(`${origin}${path}`, { headers });
            expect(response.status).toBe(401);
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.text()).not.toContain("private-image-content");
        }
    const session = await app.request(`${origin}/auth/session`);
    expect(await session.json()).toEqual({ session: null });
    const health = await app.request("http://localhost/health");
    expect(await health.json()).toEqual({ status: "ok" });
});

it("sets a host-only secure session cookie and restricts purchase changes to the owner", async () => {
    const { app } = await fixture();
    const shared = await signedIn(app);
    const setCookie = shared.response.headers.get("set-cookie")!;
    expect(setCookie).toContain("__Host-home-session=");
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=604800"])
        expect(setCookie).toContain(attribute);
    expect(setCookie).not.toContain("Domain=");
    expect(shared.body.session).toMatchObject({ username: "home", role: "commenter" });
    expect(JSON.stringify(shared.body)).not.toContain(shared.headers.Cookie.split("=")[1]);
    const read = await app.request(`${origin}/trpc/auth.session`, { headers: shared.headers });
    expect(read.status).toBe(200);
    const image = await app.request(`${origin}/media/private.png`, { headers: shared.headers });
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe("no-store");
    const input = {
        json: {
            id: "00000000-0000-4000-8000-000000000002",
            purchased: true,
            expectedStatus: "En lista",
        },
    };
    const save = (headers: Record<string, string>) =>
        app.request(`${origin}/trpc/shopping.setPurchased`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
    const blocked = await save({ ...shared.headers, "X-User-Role": "owner" });
    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toContain("Solo el propietario");
    const owner = await signedIn(app, "owner");
    expect(owner.body.session.role).toBe("owner");
    // Reaches the domain's integration-configuration check only after owner authorization.
    expect((await save(owner.headers)).status).toBe(412);
});

it("rejects missing/foreign origins, spoofed hosts and missing/invalid CSRF tokens", async () => {
    const { app } = await fixture();
    const shared = await signedIn(app);
    for (const headers of [
        { ...shared.headers, Origin: "https://other.example" },
        { ...shared.headers, Origin: "null" },
        { Cookie: shared.headers.Cookie, "x-csrf-token": shared.headers["x-csrf-token"] },
        { ...shared.headers, Host: "localhost" },
        { Cookie: shared.headers.Cookie, Origin: origin },
        { ...shared.headers, "x-csrf-token": "a".repeat(43) },
        { ...shared.headers, "x-csrf-token": "é".repeat(43) },
    ]) {
        expect(
            (
                await app.request(`${origin}/trpc/shopping.refresh`, {
                    method: "POST",
                    headers,
                    body: "{}",
                })
            ).status,
        ).toBe(403);
    }
    const crossLogin = await app.request(`${origin}/auth/login`, {
        method: "POST",
        headers: { Origin: "https://other.example", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "home", password: testPasswords.home }),
    });
    expect(crossLogin.status).toBe(403);
    const noOrigin = await app.request(`${origin}/auth/login`, { method: "POST", body: "{}" });
    expect(noOrigin.status).toBe(403);
});

it("rotates sessions on login and revokes them on logout, expiry and process replacement", async () => {
    const { app, auth, advance } = await fixture();
    const first = await signedIn(app);
    const replacement = await app.request(`${origin}/auth/login`, {
        method: "POST",
        headers: { ...first.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "owner", password: testPasswords.owner }),
    });
    expect(replacement.status).toBe(200);
    expect(
        (await app.request(`${origin}/trpc/collection`, { headers: first.headers })).status,
    ).toBe(401);
    const second = await signedIn(app);
    const logout = await app.request(`${origin}/auth/logout`, {
        method: "POST",
        headers: second.headers,
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
        (await app.request(`${origin}/trpc/collection`, { headers: second.headers })).status,
    ).toBe(401);
    const expiring = await signedIn(app);
    const token = expiring.headers.Cookie.split("=")[1]!;
    expect(auth.read(token)).not.toBeNull();
    expect(createTestAuth().read(token)).toBeNull();
    advance(7 * 24 * 60 * 60 * 1000);
    expect(
        (await app.request(`${origin}/trpc/collection`, { headers: expiring.headers })).status,
    ).toBe(401);
});

it("throttles failed logins without trusting forwarded addresses and recovers after the window", async () => {
    const { app, advance } = await fixture();
    for (let attempt = 0; attempt < 5; attempt++) {
        const response = await app.request(`${origin}/auth/login`, {
            method: "POST",
            headers: {
                Origin: origin,
                "Content-Type": "application/json",
                "X-Forwarded-For": `192.0.2.${attempt}`,
            },
            body: JSON.stringify({ username: "home", password: "incorrect" }),
        });
        expect(response.status).toBe(401);
        expect(await response.text()).not.toContain("scrypt");
    }
    const limited = await login(app);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    advance(15 * 60 * 1000);
    expect((await login(app)).status).toBe(200);
});

it("rejects malformed credentials and oversized login bodies without creating a session", async () => {
    const { app } = await fixture();
    for (const body of [
        "not-json",
        JSON.stringify({ username: "home", password: testPasswords.home, role: "owner" }),
    ]) {
        const response = await app.request(`${origin}/auth/login`, {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body,
        });
        expect(response.status).toBe(400);
        expect(response.headers.has("set-cookie")).toBe(false);
    }
    const large = await app.request(`${origin}/auth/login`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "a".repeat(9000),
    });
    expect(large.status).toBe(413);
});

it("fails closed on missing credentials, identical accounts and non-HTTPS production origins", () => {
    expect(() => readEnvironment({ NODE_ENV: "production", APP_ORIGIN: origin })).toThrow();
    const input = {
        NODE_ENV: "production",
        APP_ORIGIN: origin,
        AUTH_SHARED_PASSWORD_HASH: testHashes.home,
        AUTH_OWNER_PASSWORD_HASH: testHashes.owner,
    };
    expect(readEnvironment(input).AUTH_SHARED_USERNAME).toBe("home");
    expect(() => readEnvironment({ ...input, NOTION_API_TOKEN: "synthetic-token" })).toThrow(
        "Set your own Notion",
    );
    expect(() => readEnvironment({ ...input, AUTH_OWNER_USERNAME: "home" })).toThrow();
    expect(() =>
        readEnvironment({ ...input, AUTH_OWNER_PASSWORD_HASH: testHashes.home }),
    ).toThrow();
    for (const APP_ORIGIN of [
        "http://home.example.test",
        "http://localhost:5173",
        "https://name:secret@example.test",
        "https://home.example.test/path",
    ])
        expect(() => readEnvironment({ ...input, APP_ORIGIN })).toThrow();
    expect(() => new AuthenticationService([])).toThrow();
});

it("uses randomly salted scrypt hashes and checks passwords without storing plaintext", async () => {
    const first = await hashPassword(testPasswords.home);
    const second = await hashPassword(testPasswords.home);
    expect(first).not.toBe(second);
    expect(first).not.toContain(testPasswords.home);
    expect(await verifyPassword(testPasswords.home, first)).toBe(true);
    expect(await verifyPassword("wrong", first)).toBe(false);
    expect(await verifyPassword(testPasswords.home, "malformed")).toBe(false);
}, 10_000);
