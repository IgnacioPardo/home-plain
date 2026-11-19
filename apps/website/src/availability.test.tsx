import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CollectionSnapshot, ShoppingDashboard, ShoppingItem } from "@repo/client";
import { GlobalSearch } from "./search";
import { PlanPage } from "./plan";

type QueryState<T> = {
    data: T | undefined;
    isError: boolean;
    isPending: boolean;
    isFetching: boolean;
    refetch: ReturnType<typeof vi.fn>;
};
function query<T>(data: T | undefined, isError = false): QueryState<T> {
    return { data, isError, isPending: false, isFetching: false, refetch: vi.fn() };
}
let shopping: QueryState<ShoppingDashboard>;
let collection: QueryState<CollectionSnapshot | null>;
vi.mock("./content.queries", () => ({
    useContentIndex: () => ({
        data: undefined,
        isPending: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
    }),
}));
vi.mock("./home.queries", () => ({
    useDashboard: () => shopping,
    useCollection: () => collection,
    useMoodboard: () => ({
        data: null,
        isPending: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
    }),
    useRefresh: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
}));

function dashboard(items: ShoppingItem[] = []): ShoppingDashboard {
    return {
        configured: false,
        state: "offline",
        issue: "not_configured",
        snapshot: {
            version: 1,
            source: "import",
            dataSourceId: "00000000-0000-4000-8000-000000000001",
            syncedAt: "2026-11-12T12:00:00Z",
            items,
        },
    };
}
const recoveredItem: ShoppingItem = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Objeto recuperado",
    room: "Cocina",
    priority: "Esencial",
    status: "En lista",
    origin: "Propuesto",
    url: "https://example.com/item",
    initialQuantity: "1",
    targetQuantity: "1",
    quality: "",
    condition: "",
    notes: "",
    estimatedPriceArs: null,
    reference: null,
};
const notes: CollectionSnapshot = {
    version: 2,
    source: "import",
    importedAt: "2026-11-12T12:00:00Z",
    entries: [
        {
            productSource: null,
            provenance: "legacy",
            ownership: "unknown",
            brand: null,
            model: null,
            materials: [],
            reason: null,
            rooms: [],
            shoppingRelation: null,
            images: [],
            id: "test-note",
            kind: "note",
            title: "Nota disponible",
            subtitle: "",
            body: "",
            category: "Ejemplo",
            label: "Propuesto",
            image: null,
            imageAlt: "",
            imageSource: null,
            source: { title: "Ejemplo", url: "https://example.com/note" },
            shoppingItemId: null,
            layout: "note",
            tone: "paper",
        },
    ],
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // The DOM emulator does not implement native dialog top-layer behavior.
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
    shopping = query(dashboard());
    collection = query(null);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});
async function openSearch() {
    await act(async () => root.render(<GlobalSearch />));
    await act(async () =>
        container.querySelector<HTMLButtonElement>("[aria-label='Buscar en Home']")!.click(),
    );
}
function retryButton() {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent === "Volver a intentar",
    )!;
}

it("shows unavailable search instead of no matches when both requests fail", async () => {
    shopping = query<ShoppingDashboard>(undefined, true);
    collection = query<CollectionSnapshot | null>(undefined, true);
    await openSearch();
    expect(container.textContent).toContain("La búsqueda no está disponible.");
    expect(container.textContent).not.toContain("No encontramos");
    await act(async () => retryButton().click());
    expect(shopping.refetch).toHaveBeenCalledOnce();
    expect(collection.refetch).toHaveBeenCalledOnce();
});

it("keeps partial results and retries only the failed source, then shows recovered results", async () => {
    shopping = query<ShoppingDashboard>(undefined, true);
    collection = query(notes);
    shopping.refetch.mockImplementation(() => {
        shopping.data = dashboard([recoveredItem]);
        shopping.isError = false;
    });
    await openSearch();
    expect(container.textContent).toContain("Nota disponible");
    expect(container.textContent).toContain("pueden estar incompletos");
    await act(async () => retryButton().click());
    expect(shopping.refetch).toHaveBeenCalledOnce();
    expect(collection.refetch).not.toHaveBeenCalled();
    await act(async () => root.render(<GlobalSearch />));
    expect(container.textContent).toContain("Objeto recuperado");
    expect(container.textContent).toContain("Nota disponible");
    expect(container.textContent).not.toContain("pueden estar incompletos");
});

it("retains cached matches after refresh failure and disables retry while fetching", async () => {
    shopping = query(dashboard([recoveredItem]), true);
    shopping.isFetching = true;
    collection = query(notes, true);
    await openSearch();
    expect(container.textContent).toContain("Objeto recuperado");
    expect(container.textContent).toContain("Nota disponible");
    expect(container.textContent).not.toContain("La búsqueda no está disponible.");
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent === "Reintentando…",
    )!;
    expect(retry.disabled).toBe(true);
});

it("reports no matches only after successfully loading an empty snapshot", async () => {
    await openSearch();
    expect(container.textContent).toContain("No encontramos nada con ese nombre.");
    expect(container.textContent).not.toContain("no está disponible");
});

it("does not describe absent search sources as empty results", async () => {
    shopping = query({
        configured: false,
        state: "unconfigured",
        snapshot: null,
        issue: "not_configured",
    });
    await openSearch();
    expect(container.textContent).toContain("No hay datos disponibles para buscar.");
    expect(container.textContent).not.toContain("No encontramos");
});

it.each(["unconfigured", "error"] as const)(
    "does not claim purchases or prices are empty when %s has no snapshot",
    async (state) => {
        shopping = query({
            configured: state === "error",
            state,
            snapshot: null,
            issue: "not_configured",
        });
        await act(async () => root.render(<PlanPage />));
        expect(container.textContent).toContain("Datos de compras no disponibles.");
        expect(container.textContent).not.toContain("No hay compras registradas.");
        expect(container.textContent).not.toContain("No hay precios registrados en Notion.");
        expect(container.textContent).not.toContain("0 de 0 objetos");
    },
);

it("reports a successfully loaded empty plan and its missing prices", async () => {
    await act(async () => root.render(<PlanPage />));
    expect(container.textContent).toContain("No hay compras registradas.");
    expect(container.textContent).toContain("No hay precios registrados en Notion.");
});

it.each(["cancel", "close button"])(
    "returns focus to the search trigger after %s",
    async (action) => {
        await act(async () => root.render(<GlobalSearch />));
        const trigger = container.querySelector<HTMLButtonElement>(
            "[aria-label='Buscar en Home']",
        )!;
        trigger.focus();
        await act(async () => trigger.click());
        const dialog = container.querySelector<HTMLDialogElement>("dialog")!;
        expect(document.activeElement).toBe(dialog.querySelector("[data-autofocus]"));
        await act(async () => {
            if (action === "cancel") {
                dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
            } else {
                dialog.querySelector<HTMLButtonElement>("[aria-label='Cerrar']")!.click();
            }
        });
        expect(container.querySelector("dialog")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    },
);
