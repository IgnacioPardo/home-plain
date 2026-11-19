// Feedback has separate query/HTTP and form tests. These tests isolate the existing page behavior.
vi.mock("./feedback", () => ({ FeedbackPanel: () => null, FeedbackNotes: () => null }));
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShoppingDashboard, ShoppingItem } from "@repo/client";
import { ChecklistPage } from "./checklist";

const sample: ShoppingItem = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Colchón",
    room: "Dormitorio",
    priority: "Esencial",
    status: "En lista",
    origin: "Confirmado",
    url: "https://example.com/item",
    initialQuantity: "1",
    targetQuantity: "2",
    quality: "",
    condition: "Medir el espacio",
    notes: "",
    estimatedPriceArs: null,
    reference: null,
};
const items: ShoppingItem[] = [
    {
        ...sample,
        id: "00000000-0000-4000-8000-000000000002",
        name: "Almohadas",
        status: "Comprado",
    },
    sample,
    {
        ...sample,
        id: "00000000-0000-4000-8000-000000000003",
        name: "Mesa",
        room: "Comedor",
        status: "Depende del depto",
        origin: "Condicionado",
    },
    {
        ...sample,
        id: "00000000-0000-4000-8000-000000000004",
        name: "Lámpara",
        room: "",
        origin: "Propuesto",
    },
];
function dashboard(rows = items): ShoppingDashboard {
    return {
        configured: false,
        state: "offline",
        issue: "not_configured",
        snapshot: {
            version: 1,
            source: "import",
            dataSourceId: "00000000-0000-4000-8000-000000000009",
            syncedAt: "2026-11-12T12:00:00Z",
            items: rows,
        },
    };
}
let query: {
    data: ShoppingDashboard | undefined;
    isError: boolean;
    isPending: boolean;
    isFetching: boolean;
    refetch: ReturnType<typeof vi.fn>;
};
let purchase: {
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: Error;
    mutate: ReturnType<typeof vi.fn>;
};
let sessionRole: "owner" | "commenter" = "owner";
vi.mock("./auth", () => ({
    useSession: () => ({ role: sessionRole, username: "test", csrfToken: "test" }),
}));
vi.mock("./home.queries", () => ({ useDashboard: () => query, useSetPurchased: () => purchase }));
vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        children,
        className,
    }: {
        to: string;
        children: ReactNode;
        className?: string;
    }) => (
        <a href={to} className={className}>
            {children}
        </a>
    ),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    sessionRole = "owner";
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    purchase = {
        isPending: false,
        isError: false,
        isSuccess: false,
        error: new Error("No se pudo confirmar el cambio. Volvé a intentarlo."),
        mutate: vi.fn(),
    };
    query = {
        data: dashboard(),
        isError: false,
        isPending: false,
        isFetching: false,
        refetch: vi.fn(),
    };
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
        function (this: HTMLDialogElement) {
            this.open = true;
        },
    );
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(
        function (this: HTMLDialogElement) {
            this.open = false;
        },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});
async function render() {
    await act(async () => root.render(<ChecklistPage />));
}
function button(text: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent === text,
    )!;
}
function names() {
    return [...container.querySelectorAll(".checklist-item-name")].map((n) => n.textContent);
}
async function change(selector: string, value: string) {
    const node = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    await act(async () => {
        const prototype =
            node instanceof HTMLInputElement
                ? HTMLInputElement.prototype
                : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
        node.dispatchEvent(
            new Event(node instanceof HTMLInputElement ? "input" : "change", { bubbles: true }),
        );
    });
}
it("checks only purchased items, includes every definition and groups unassigned rooms", async () => {
    await render();
    expect(container.querySelector(".is-purchased")?.textContent).toContain("Almohadas");
    expect(container.querySelectorAll(".is-purchased")).toHaveLength(1);
    expect(container.querySelector("progress")?.value).toBe(1);
    expect(container.querySelector("progress")?.max).toBe(4);
    expect(container.textContent).toContain("3 pendientes");
    expect(names()).toEqual(["Mesa", "Colchón", "Almohadas", "Lámpara"]);
    expect(container.textContent).toContain("Sin ambiente");
    for (const origin of ["Confirmado", "Condicionado", "Propuesto"])
        expect(container.textContent).toContain(origin);
    expect(container.querySelector('a[href="/compras"]')).not.toBeNull();
});
it("combines purchase, room and accent-insensitive search filters and resets them", async () => {
    await render();
    await act(async () => button("Pendientes").click());
    await change('select[aria-label="Ambiente"]', "Dormitorio");
    await change("input", "COLCHON");
    expect(names()).toEqual(["Colchón"]);
    expect(container.querySelector("progress")?.max).toBe(4);
    await act(async () => button("Comprados").click());
    expect(container.textContent).toContain("No hay objetos con estos filtros.");
    await act(async () => button("Ver todos los objetos").click());
    expect(names()).toHaveLength(4);
    expect(button("Todos").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Comprados").click());
    expect(names()).toEqual(["Almohadas"]);
});
it("opens details with the source link and follows refreshed source records without browser-only completion", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-label="Colchón. En lista. Ver detalles"]',
    )!;
    trigger.focus();
    await act(async () => trigger.click());
    expect(container.querySelector("dialog")?.textContent).toContain("Medir el espacio");
    expect(container.querySelector('dialog a[href="https://example.com/item"]')).not.toBeNull();
    expect(container.querySelector("dialog")?.textContent).toContain("Sin cotizar");
    query.data = dashboard(
        items.map((item) => (item.id === sample.id ? { ...item, status: "Comprado" } : item)),
    );
    await render();
    expect(container.querySelector("progress")?.value).toBe(2);
    expect(container.querySelector("dialog")?.textContent).toContain("Comprado");
    await act(async () =>
        container
            .querySelector("dialog")!
            .dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(localStorage.length).toBe(0);
});
it("retains stale and cached records during refresh failure with a retry", async () => {
    query.data!.state = "stale";
    query.isError = true;
    await render();
    expect(names()).toHaveLength(4);
    expect(container.textContent).toContain("última lista disponible");
    await act(async () => button("Volver a intentar").click());
    expect(query.refetch).toHaveBeenCalledOnce();
    query.isFetching = true;
    await render();
    expect(button("Reintentando…").disabled).toBe(true);
});
it.each(["unconfigured", "error"] as const)(
    "does not invent totals when %s has no snapshot",
    async (state) => {
        query.data = { configured: false, state, issue: "not_configured", snapshot: null };
        await render();
        expect(container.textContent).toContain("Datos de compras no disponibles.");
        expect(container.textContent).not.toContain("No hay compras registradas.");
        expect(container.querySelector("progress")).toBeNull();
    },
);
it("distinguishes loading, request failure and an empty source", async () => {
    query.data = undefined;
    query.isPending = true;
    await render();
    expect(container.textContent).toContain("Cargando lista…");
    query.isPending = false;
    query.isError = true;
    await render();
    expect(container.textContent).toContain("No se pudo cargar la lista.");
    await act(async () => button("Volver a intentar").click());
    expect(query.refetch).toHaveBeenCalledOnce();
    query.isError = false;
    query.data = dashboard([]);
    await render();
    expect(container.textContent).toContain("No hay compras registradas.");
    expect(container.querySelector("progress")).toBeNull();
});

it("disables writes without a configured integration while keeping details usable", async () => {
    await render();
    expect(container.textContent).toContain("Datos no disponibles");
    const checkbox = container.querySelector<HTMLInputElement>(
        '[aria-label="Marcar Colchón como comprado"]',
    )!;
    expect(checkbox.disabled).toBe(true);
    await act(async () => checkbox.click());
    expect(purchase.mutate).not.toHaveBeenCalled();
    expect(
        container.querySelector<HTMLButtonElement>(
            '[aria-label="Colchón. En lista. Ver detalles"]',
        )!.disabled,
    ).toBe(false);
});
it("saves check and uncheck to the database, waits for confirmation and announces errors without fake completion", async () => {
    query.data!.configured = true;
    await render();
    let checkbox = container.querySelector<HTMLInputElement>(
        '[aria-label="Marcar Colchón como comprado"]',
    )!;
    await act(async () => checkbox.click());
    expect(purchase.mutate).toHaveBeenLastCalledWith({
        id: sample.id,
        purchased: true,
        expectedStatus: "En lista",
        expectedVersion: 0,
    });
    expect(checkbox.checked).toBe(false);
    purchase.isPending = true;
    await render();
    expect(container.textContent).toContain("Guardando…");
    expect(
        [...container.querySelectorAll<HTMLInputElement>('[type="checkbox"]')].every(
            (i) => i.disabled,
        ),
    ).toBe(true);
    purchase.isPending = false;
    purchase.isError = true;
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "No se pudo confirmar",
    );
    expect(checkbox.checked).toBe(false);
    purchase.isError = false;
    purchase.isSuccess = true;
    query.data!.snapshot!.items = items.map((item) =>
        item.id === sample.id ? { ...item, status: "Comprado" } : item,
    );
    await render();
    checkbox = container.querySelector<HTMLInputElement>(
        '[aria-label="Marcar Colchón como pendiente"]',
    )!;
    expect(checkbox.checked).toBe(true);
    expect(container.querySelector("progress")?.value).toBe(2);
    expect(container.textContent).toContain("Estado guardado.");
    await act(async () => checkbox.click());
    expect(purchase.mutate).toHaveBeenLastCalledWith({
        id: sample.id,
        purchased: false,
        expectedStatus: "Comprado",
        expectedVersion: 0,
    });
});
it("returns keyboard focus to the active filter when a saved item leaves the pending view", async () => {
    query.data!.configured = true;
    await render();
    await act(async () => button("Pendientes").click());
    const checkbox = container.querySelector<HTMLInputElement>(
        '[aria-label="Marcar Colchón como comprado"]',
    )!;
    checkbox.focus();
    await act(async () => checkbox.click());
    query.data!.snapshot!.items = items.map((item) =>
        item.id === sample.id ? { ...item, status: "Comprado" } : item,
    );
    purchase.isSuccess = true;
    await render();
    expect(names()).not.toContain("Colchón");
    expect(document.activeElement).toBe(button("Pendientes"));
});

it("keeps purchase changes disabled for the shared commenter account", async () => {
    sessionRole = "commenter";
    query.data = { ...dashboard(), configured: true, state: "live" };
    await render();
    const toggles = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles.every((toggle) => toggle.disabled)).toBe(true);
    expect(container.textContent).toContain("Los cambios de compra los guarda el propietario");
    expect(container.textContent).not.toContain("Editar en Notion");
    expect(purchase.mutate).not.toHaveBeenCalled();
});

it("keeps missing reference photos explicit for every visible shopping item", async () => {
    await render();
    expect(container.querySelectorAll(".checklist-item img")).toHaveLength(0);
    expect(container.querySelectorAll(".checklist-item .image-fallback")).toHaveLength(
        items.length,
    );
});
