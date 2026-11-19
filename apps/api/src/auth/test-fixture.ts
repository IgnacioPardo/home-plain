import { AuthenticationService } from "./auth.service.ts";
import { createApp } from "../app.ts";

export const testPasswords = {
    home: "test-shared-password-only",
    owner: "test-owner-password-only",
};
export const testHashes = {
    home: `scrypt$131072$8$1$${"a".repeat(22)}$${"b".repeat(86)}`,
    owner: `scrypt$131072$8$1$${"c".repeat(22)}$${"d".repeat(86)}`,
};
export function createTestAuth(now: () => number = Date.now) {
    return new AuthenticationService(
        [
            { username: "home", role: "commenter", passwordHash: testHashes.home },
            { username: "owner", role: "owner", passwordHash: testHashes.owner },
        ],
        now,
        async (password, hash) =>
            password === (hash === testHashes.home ? testPasswords.home : testPasswords.owner),
    );
}
// Domain/transport regression tests run as a signed-in owner. Security tests use
// createApp directly and exercise the real login/cookie/CSRF HTTP boundary.
export async function createAuthenticatedTestApp(...args: Parameters<typeof createApp>) {
    const auth = createTestAuth();
    const app = createApp(args[0], args[1], args[2], args[3], args[4], { ...args[5], auth });
    const login = await auth.login("owner", testPasswords.owner);
    if (login.status !== "ok") throw new Error("Test login failed");
    const allowed = new URL(args[1]);
    const cookie = `${allowed.protocol === "https:" ? "__Host-home-session" : "home-session"}=${login.token}`;
    const request = app.request.bind(app);
    app.request = ((input, init, ...rest) => {
        const headers = new Headers(init?.headers);
        if (!headers.has("host")) headers.set("host", allowed.host);
        headers.set("cookie", cookie);
        headers.set("x-csrf-token", login.session.csrfToken);
        return request(input, { ...init, headers }, ...rest);
    }) as typeof app.request;
    return app;
}
