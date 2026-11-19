import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedbackNotes, FeedbackPanel } from "./feedback";
import { feedbackDraftKey } from "./feedback.drafts";

const transport = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
const identity = vi.hoisted(() => ({
    session: {
        username: "home",
        role: "commenter" as "commenter" | "owner",
        csrfToken: "test-token",
    },
}));
vi.mock("./auth", () => ({ useSession: () => identity.session }));
vi.mock("@repo/client", () => ({
    createHomeClient: () => ({
        feedback: { list: { query: transport.list }, create: { mutate: transport.create } },
    }),
}));
const empty = {
    configured: true,
    canCreate: true,
    state: "live",
    issue: null,
    snapshot: { syncedAt: "2026-11-16T12:00:00Z", entries: [] },
};
const target = { kind: "shopping" as const, id: "00000000-0000-4000-8000-000000000001" };
let container: HTMLDivElement, root: Root, cache: QueryClient;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.dispatchEvent(new Event("home:session-cleared"));
    vi.resetAllMocks();
    identity.session = { username: "home", role: "commenter", csrfToken: "test-token" };
    transport.list.mockResolvedValue(empty);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
    });
}
async function render(notes = false) {
    await act(async () =>
        root.render(
            <QueryClientProvider client={cache}>
                {notes ? <FeedbackNotes /> : <FeedbackPanel target={target} />}
            </QueryClientProvider>,
        ),
    );
    await settle();
}
async function type(selector: string, value: string) {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    await act(async () => {
        const prototype =
            element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function submit() {
    await act(async () =>
        container
            .querySelector("form")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await settle();
}

it("keeps the draft and identical operation ID after an uncertain write, clearing only on confirmation", async () => {
    await render();
    await type("textarea", "Medir antes de comprar.");
    transport.create.mockImplementationOnce(async (input) => ({
        status: "unconfirmed",
        operationId: input.operationId,
    }));
    await submit();
    expect(container.textContent).toContain("Guardado pendiente de confirmar");
    expect(container.querySelector("textarea")!.value).toBe("Medir antes de comprar.");
    expect(container.querySelector("button[type=submit]")!.textContent).toBe("Comprobar guardado");
    const submission = transport.create.mock.calls[0]![0];
    transport.create.mockResolvedValueOnce({
        status: "saved",
        entry: {
            ...submission,
            id: target.id,
            createdAt: empty.snapshot.syncedAt,
            contextUrl: "https://home.example/",
        },
    });
    await submit();
    expect(transport.create.mock.calls[1]![0]).toEqual(submission);
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.textContent).toContain("Comentario guardado.");
});
it("does not automatically retry network errors and restores drafts after closing a detail", async () => {
    await render();
    await type("textarea", "Comprobar ancho.");
    transport.create.mockRejectedValueOnce(new Error("Respuesta perdida"));
    await submit();
    expect(transport.create).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")!.value).toBe("Comprobar ancho.");
    await act(async () =>
        root.render(
            <QueryClientProvider client={cache}>
                <div>Closed</div>
            </QueryClientProvider>,
        ),
    );
    await render();
    expect(container.querySelector("textarea")!.value).toBe("Comprobar ancho.");
    expect(container.querySelector("button[type=submit]")!.textContent).toBe("Comprobar guardado");
    await act(async () => window.dispatchEvent(new Event("home:session-cleared")));
    await act(async () => root.render(<div>Logged out</div>));
    await render();
    expect(container.querySelector("textarea")!.value).toBe("");
});
it("creates a named standalone note and treats display names only as submitted labels", async () => {
    await render(true);
    await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent === "Nueva nota")!
            .click(),
    );
    await type("input", "Medidas de la entrada");
    await type("textarea", "Dejar espacio para abrir la puerta.");
    transport.create.mockImplementationOnce(async (input) => ({
        status: "unconfirmed",
        operationId: input.operationId,
    }));
    await submit();
    expect(transport.create.mock.calls[0]![0]).toMatchObject({
        kind: "note",
        title: "Medidas de la entrada",
        body: "Dejar espacio para abrir la puerta.",
        displayAuthor: "Persona A",
        target: null,
    });
    expect(transport.create.mock.calls[0]![0]).not.toHaveProperty("role");
});
it("renders feedback as text, exposes author/time, and opens comments on notes", async () => {
    transport.list.mockResolvedValue({
        ...empty,
        snapshot: {
            ...empty.snapshot,
            entries: [
                {
                    id: target.id,
                    kind: "note",
                    title: "Una nota",
                    body: "<img src=x onerror=alert(1)>\nOtra línea",
                    displayAuthor: "Persona B",
                    createdAt: empty.snapshot.syncedAt,
                    target: null,
                },
            ],
        },
    });
    await render(true);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(empty.snapshot.syncedAt);
    transport.list.mockResolvedValue(empty);
    await act(async () =>
        container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(),
    );
    await settle();
    expect(transport.list).toHaveBeenLastCalledWith(
        { target: { kind: "note", id: target.id } },
        expect.anything(),
    );
});
it("disables saving when the integration or durable journal is unavailable", async () => {
    transport.list.mockResolvedValue({
        ...empty,
        canCreate: false,
        configured: false,
        state: "unconfigured",
        snapshot: null,
    });
    await render();
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true);
    expect(container.textContent).toContain("todavía no están conectados");
    expect(transport.create).not.toHaveBeenCalled();
});

it("clears a mounted draft on account changes and ignores late results from the previous session", async () => {
    await render();
    await type("textarea", "Borrador de la sesión anterior.");
    let resolve!: (value: unknown) => void;
    transport.create.mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await submit();
    await act(async () => window.dispatchEvent(new Event("home:session-cleared")));
    expect(container.querySelector("textarea")!.value).toBe("");
    await act(async () => resolve({ status: "unconfirmed", operationId: target.id }));
    expect(container.textContent).not.toContain("Guardado pendiente");
    await act(async () => root.render(<div>Closed</div>));
    await render();
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.querySelector("button[type=submit]")!.textContent).toBe("Agregar comentario");
});

async function reload() {
    await act(async () => root.unmount());
    cache.clear();
    root = createRoot(container);
    await render();
}
function sessionChange(reason: string) {
    return act(async () =>
        window.dispatchEvent(new CustomEvent("home:session-cleared", { detail: { reason } })),
    );
}
it("recovers an uncertain submission after a full component reload and reconciles the identical payload", async () => {
    await render();
    await type("textarea", "Conservar después de recargar.");
    const key = feedbackDraftKey(identity.session, target);
    transport.create.mockImplementationOnce(async (input) => {
        expect(JSON.parse(sessionStorage.getItem(key)!).submission).toEqual(input);
        return { status: "unconfirmed", operationId: input.operationId };
    });
    await submit();
    const original = transport.create.mock.calls[0]![0];
    await reload();
    expect(container.textContent).toContain("Borrador recuperado de esta pestaña");
    expect(container.querySelector("textarea")!.value).toBe(original.body);
    expect(container.querySelector("textarea")!.readOnly).toBe(true);
    transport.create.mockResolvedValueOnce({
        status: "saved",
        entry: { ...original, id: target.id },
    });
    await submit();
    expect(transport.create.mock.calls[1]![0]).toEqual(original);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(container.querySelector("textarea")!.value).toBe("");
});
it("retains a pending submission through expiry and ignores a late result before same-account recovery", async () => {
    await render();
    await type("textarea", "Recuperar al volver a entrar.");
    let resolve!: (value: unknown) => void;
    transport.create.mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await submit();
    const original = transport.create.mock.calls[0]![0];
    await sessionChange("expired");
    expect(container.querySelector("textarea")!.value).toBe("");
    await act(async () => resolve({ status: "saved", entry: { ...original, id: target.id } }));
    expect(
        JSON.parse(sessionStorage.getItem(feedbackDraftKey(identity.session, target))!).submission,
    ).toEqual(original);
    await reload();
    expect(container.querySelector("textarea")!.value).toBe(original.body);
    transport.create.mockResolvedValueOnce({
        status: "unconfirmed",
        operationId: original.operationId,
    });
    await submit();
    expect(transport.create.mock.calls[1]![0]).toEqual(original);
});
it("preserves a draft on same-account token rotation and clears it on explicit logout", async () => {
    await render();
    await type("textarea", "Continuar con la misma cuenta.");
    await sessionChange("refreshed");
    expect(container.querySelector("textarea")!.value).toBe("Continuar con la misma cuenta.");
    await reload();
    expect(container.querySelector("textarea")!.value).toBe("Continuar con la misma cuenta.");
    await sessionChange("logout");
    await reload();
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(sessionStorage.getItem(feedbackDraftKey(identity.session, target))).toBeNull();
});
it("never hydrates another account's draft after reload even without an account-change event", async () => {
    await render();
    await type("textarea", "Borrador de home.");
    identity.session = { username: "owner", role: "owner", csrfToken: "owner-token" };
    await reload();
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.textContent).not.toContain("Borrador recuperado");
    await type("textarea", "Borrador del propietario.");
    await sessionChange("logout");
    identity.session = { username: "home", role: "commenter", csrfToken: "test-token" };
    await reload();
    expect(container.querySelector("textarea")!.value).toBe("");
});
it("fails visibly before dispatch if the exact pending operation cannot be persisted", async () => {
    await render();
    await type("textarea", "No perder el identificador.");
    const storage = sessionStorage;
    vi.stubGlobal("sessionStorage", {
        getItem: storage.getItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
        setItem: (key: string, value: string) => {
            if (JSON.parse(value).submission)
                throw new DOMException("Quota exceeded", "QuotaExceededError");
            storage.setItem(key, value);
        },
    });
    await submit();
    expect(transport.create).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No se envió a Notion");
    expect(container.querySelector("textarea")!.value).toBe("No perder el identificador.");
    vi.unstubAllGlobals();
    transport.create.mockImplementationOnce(async (input) => ({
        status: "unconfirmed",
        operationId: input.operationId,
    }));
    await submit();
    expect(transport.create).toHaveBeenCalledTimes(1);
});
it("blocks corrupt recovered submissions without overwriting them or creating a replacement operation", async () => {
    const key = feedbackDraftKey(identity.session, target);
    const corrupt = JSON.stringify({
        title: "",
        body: "Texto",
        displayAuthor: "Persona A",
        submission: { operationId: "broken" },
    });
    sessionStorage.setItem(key, corrupt);
    await render();
    expect(container.textContent).toContain("No se pudo recuperar este borrador con seguridad");
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    await submit();
    expect(transport.create).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(corrupt);
});

it.each(["denied", "corrupt"])(
    "preserves the canonical pending draft when storage becomes %s during token refresh",
    async (failure) => {
        await render();
        await type("textarea", "No reemplazar este envío.");
        transport.create.mockImplementation(async (input) => ({
            status: "unconfirmed",
            operationId: input.operationId,
        }));
        await submit();
        const original = transport.create.mock.calls[0]![0];
        if (failure === "denied")
            vi.stubGlobal("sessionStorage", {
                getItem: () => {
                    throw new DOMException("Denied", "SecurityError");
                },
            });
        else sessionStorage.setItem(feedbackDraftKey(identity.session, target), "{corrupt");
        await sessionChange("refreshed");
        expect(container.querySelector("textarea")!.value).toBe(original.body);
        expect(container.querySelector("button[type=submit]")!.textContent).toBe(
            "Comprobar guardado",
        );
        vi.unstubAllGlobals();
        await submit();
        expect(transport.create.mock.calls[1]![0]).toEqual(original);
    },
);
