import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHomeClient, setHomeCsrfToken, type AuthSession } from "@repo/client";
import { AuthGate, SessionControls, useSession } from "./auth";

const owner: AuthSession = { username: "owner", role: "owner", csrfToken: "a".repeat(43) };
const shared: AuthSession = { username: "home", role: "commenter", csrfToken: "b".repeat(43) };
let container: HTMLDivElement;
let root: Root;
let cache: QueryClient;
const request = vi.fn<typeof fetch>();
function Probe() {
    return (
        <>
            <p data-private>Contenido privado: {useSession()?.username}</p>
            <SessionControls />
        </>
    );
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    request.mockReset();
    vi.stubGlobal("fetch", request);
    setHomeCsrfToken(null);
    cache = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    cache.clear();
    container.remove();
    vi.unstubAllGlobals();
});
async function render() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={cache}>
                <AuthGate>
                    <Probe />
                </AuthGate>
            </QueryClientProvider>,
        ),
    );
}
async function fill(selector: string, value: string) {
    await act(async () => {
        const input = container.querySelector<HTMLInputElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            input,
            value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function submit() {
    await act(async () =>
        container
            .querySelector("form")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
}

it("shows no private content before a session check and offers retry on network failure", async () => {
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    await render();
    expect(container.textContent).toContain("Comprobando sesión");
    expect(container.querySelector("[data-private]")).toBeNull();
    await act(async () => pending.resolve(new Response("unavailable", { status: 503 })));
    expect(container.querySelector("[data-private]")).toBeNull();
    expect(container.textContent).toContain("No se pudo comprobar");
    expect(container.textContent).toContain("Volver a comprobar");
});

it("submits a labelled login form, displays server errors and supports the shared account", async () => {
    request.mockResolvedValueOnce(Response.json({ session: null }));
    await render();
    expect(container.querySelector('label[for="login-username"]')?.textContent).toBe("Usuario");
    expect(container.querySelector('input[name="password"]')?.getAttribute("autocomplete")).toBe(
        "current-password",
    );
    await fill('[name="username"]', "home");
    await fill('[name="password"]', "wrong");
    request.mockResolvedValueOnce(
        Response.json({ error: "El usuario o la contraseña no son correctos." }, { status: 401 }),
    );
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("no son correctos");
    expect(container.querySelector("[data-private]")).toBeNull();
    await fill('[name="password"]', "correct-test-password");
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    await submit();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(request).toHaveBeenCalledTimes(3);
    await act(async () => pending.resolve(Response.json({ session: shared })));
    expect(container.querySelector("[data-private]")?.textContent).toContain("home");
    expect(container.querySelector("form")).toBeNull();
    const init = request.mock.calls[2]![1]!;
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({
        username: "home",
        password: "correct-test-password",
    });
});

it("clears private caches and drafts on logout and ignores a late previous-session response", async () => {
    request.mockResolvedValueOnce(Response.json({ session: owner }));
    await render();
    cache.setQueryData(["private"], { secret: "private record" });
    const cleared = vi.fn();
    window.addEventListener("home:session-cleared", cleared);
    try {
        const late = deferred<Response>();
        request.mockReturnValueOnce(late.promise);
        await act(async () => window.dispatchEvent(new Event("focus")));
        request.mockResolvedValueOnce(Response.json({ session: null }));
        await act(async () =>
            container.querySelector<HTMLButtonElement>('[aria-label="Cerrar sesión"]')!.click(),
        );
        expect(cache.getQueryData(["private"])).toBeUndefined();
        expect(cleared).toHaveBeenCalledTimes(1);
        expect(cleared.mock.calls[0]![0].detail).toEqual({ reason: "logout" });
        expect(container.querySelector("[data-private]")).toBeNull();
        const logout = request.mock.calls.find(([url]) => String(url).endsWith("/logout"))!;
        expect(new Headers(logout[1]?.headers).get("x-csrf-token")).toBe(owner.csrfToken);
        await act(async () => late.resolve(Response.json({ session: owner })));
        expect(container.querySelector("[data-private]")).toBeNull();
    } finally {
        window.removeEventListener("home:session-cleared", cleared);
    }
});

it("hides cached private content when tRPC reports an expired session", async () => {
    request.mockResolvedValueOnce(Response.json({ session: owner }));
    await render();
    cache.setQueryData(["private"], "old value");
    request.mockResolvedValueOnce(
        Response.json({ error: "Authentication required" }, { status: 401 }),
    );
    await act(async () => {
        await createHomeClient()
            .auth.session.query()
            .catch(() => {});
    });
    expect(container.querySelector("[data-private]")).toBeNull();
    expect(container.textContent).toContain("Tu sesión terminó");
    expect(cache.getQueryData(["private"])).toBeUndefined();
});

it("confirms a lost logout response with a session read instead of claiming an unverified result", async () => {
    request.mockResolvedValueOnce(Response.json({ session: owner }));
    await render();
    request.mockRejectedValueOnce(new Error("network failed"));
    request.mockResolvedValueOnce(Response.json({ session: null }));
    await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Cerrar sesión"]')!.click(),
    );
    expect(container.querySelector("[data-private]")).toBeNull();
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
        "/auth/session",
        "/auth/logout",
        "/auth/session",
    ]);
});

it("distinguishes session expiry, token rotation and a changed authenticated account", async () => {
    request.mockResolvedValueOnce(Response.json({ session: shared }));
    await render();
    const cleared = vi.fn();
    window.addEventListener("home:session-cleared", cleared);
    try {
        request.mockResolvedValueOnce(
            Response.json({ session: { ...shared, csrfToken: "c".repeat(43) } }),
        );
        cache.setQueryData(["private"], "old value");
        await act(async () => window.dispatchEvent(new Event("focus")));
        expect(cleared.mock.calls[0]![0].detail).toEqual({ reason: "refreshed" });
        expect(cache.getQueryData(["private"])).toBeUndefined();
        request.mockResolvedValueOnce(Response.json({ session: owner }));
        await act(async () => window.dispatchEvent(new Event("focus")));
        expect(cleared.mock.calls[1]![0].detail).toEqual({ reason: "changed" });
        request.mockResolvedValueOnce(Response.json({ session: null }));
        await act(async () => window.dispatchEvent(new Event("focus")));
        expect(cleared.mock.calls[2]![0].detail).toEqual({ reason: "expired" });
        expect(container.querySelector("[data-private]")).toBeNull();
    } finally {
        window.removeEventListener("home:session-cleared", cleared);
    }
});
it("clears recoverable drafts only after an uncertain logout is verified as complete", async () => {
    request.mockResolvedValueOnce(Response.json({ session: shared }));
    await render();
    const cleared = vi.fn();
    window.addEventListener("home:session-cleared", cleared);
    try {
        request.mockRejectedValueOnce(new Error("network failed"));
        request.mockRejectedValueOnce(new Error("session read failed"));
        await act(async () =>
            container.querySelector<HTMLButtonElement>('[aria-label="Cerrar sesión"]')!.click(),
        );
        expect(cleared).not.toHaveBeenCalled();
        expect(container.querySelector("[data-private]")).not.toBeNull();
        expect(container.textContent).toContain("No se pudo cerrar la sesión");
        request.mockRejectedValueOnce(new Error("response lost"));
        request.mockResolvedValueOnce(Response.json({ session: null }));
        await act(async () =>
            container.querySelector<HTMLButtonElement>('[aria-label="Cerrar sesión"]')!.click(),
        );
        expect(cleared).toHaveBeenCalledTimes(1);
        expect(cleared.mock.calls[0]![0].detail).toEqual({ reason: "logout" });
        expect(container.querySelector("[data-private]")).toBeNull();
    } finally {
        window.removeEventListener("home:session-cleared", cleared);
    }
});

it.each(["confirmed", "lost"])(
    "clears recovery when expiry races an explicit logout whose response is %s",
    async (outcome) => {
        request.mockResolvedValueOnce(Response.json({ session: shared }));
        await render();
        const cleared = vi.fn();
        window.addEventListener("home:session-cleared", cleared);
        try {
            const pendingLogout = deferred<Response>();
            request.mockReturnValueOnce(pendingLogout.promise);
            await act(async () =>
                container.querySelector<HTMLButtonElement>('[aria-label="Cerrar sesión"]')!.click(),
            );
            request.mockResolvedValueOnce(Response.json({ error: "Expired" }, { status: 401 }));
            await act(async () => {
                await createHomeClient()
                    .auth.session.query()
                    .catch(() => {});
            });
            expect(container.querySelector("[data-private]")).toBeNull();
            expect(cleared).toHaveBeenCalledTimes(1);
            expect(cleared.mock.calls[0]![0].detail).toEqual({ reason: "logout" });
            if (outcome === "lost")
                request.mockRejectedValueOnce(new Error("Session read unavailable"));
            await act(async () =>
                pendingLogout.resolve(
                    outcome === "confirmed"
                        ? Response.json({ session: null })
                        : new Response("Unavailable", { status: 503 }),
                ),
            );
            expect(container.querySelector("[data-private]")).toBeNull();
            expect(cleared).toHaveBeenCalledTimes(1);
            request.mockResolvedValueOnce(Response.json({ session: owner }));
            await fill('[name="username"]', "owner");
            await fill('[name="password"]', "test-owner-password");
            await submit();
            expect(container.querySelector("[data-private]")?.textContent).toContain("owner");
            expect(cleared).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener("home:session-cleared", cleared);
        }
    },
);
