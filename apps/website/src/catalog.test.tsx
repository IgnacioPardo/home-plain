import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CollectionPage, CollectionCard, CollectionDetail, filterCatalog } from "./collection";
import { catalogFixture } from "./catalog-fixtures";
import { categoryOrder } from "./catalog-model";
import type { ReactNode } from "react";

const fixtures = [
    catalogFixture(),
    catalogFixture({
        id: "keyboard",
        title: "Teclado",
        model: "Modelo B",
        category: "Trabajo",
        brand: "Otra marca",
        provenance: "my-gear",
        ownership: "owned",
    }),
    catalogFixture({
        id: "note",
        kind: "note",
        title: "Medidas",
        body: "Medir el lugar antes de definir el tamaño.",
        image: null,
        images: [],
    }),
];
const state = vi.hoisted(() => ({ stale: false }));
vi.mock("./home.queries", () => ({
    useCollection: () => ({
        data: { version: 2, entries: fixtures, importedAt: "2026-11-18T00:00:00Z" },
        isPending: false,
        isError: false,
    }),
    useCollectionStatus: () => ({ data: { state: state.stale ? "stale" : "ready" } }),
    useDashboard: () => ({ data: { snapshot: { items: [] } }, isPending: false, isError: false }),
}));
vi.mock("./feedback", () => ({ FeedbackPanel: () => null }));
vi.mock("@tanstack/react-router", () => ({
    Link: ({ children, to, hash, ...rest }: { children: ReactNode; to: string; hash?: string }) => (
        <a href={`${to}${hash ? `#${hash}` : ""}`} {...rest}>
            {children}
        </a>
    ),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/");
    state.stale = false;
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
const all = { query: "", category: "", brand: "", provenance: "all" as const };
it("combines category, brand, provenance and accent-insensitive product facts", () => {
    expect(
        filterCatalog(fixtures, {
            ...all,
            query: "acero",
            brand: "Estudio de prueba",
            category: "Hogar",
            provenance: "home-reference",
        }).map((entry) => entry.id),
    ).toEqual(["fixture-lamp"]);
    expect(
        filterCatalog(fixtures, { ...all, query: "TECLÁDO", provenance: "my-gear" }).map(
            (entry) => entry.id,
        ),
    ).toEqual(["keyboard"]);
    expect(
        filterCatalog(fixtures, { ...all, brand: "Otra marca", provenance: "home-reference" }),
    ).toEqual([]);
    expect(["Otros", "Trabajo", "Hogar", "Audio y música"].sort(categoryOrder)).toEqual([
        "Hogar",
        "Trabajo",
        "Audio y música",
        "Otros",
    ]);
});
it("renders Hogar first, keeps notes out of the catalog and filters without hiding the control", async () => {
    await act(async () => root.render(<CollectionPage />));
    expect(
        [...container.querySelectorAll(".catalog-section-heading h2")].map(
            (node) => node.textContent,
        ),
    ).toEqual(["Hogar", "Trabajo"]);
    expect(container.querySelectorAll(".catalog-card")).toHaveLength(2);
    expect(container.textContent).not.toContain("Medidas");
    await act(async () =>
        [...container.querySelectorAll("button")]
            .find((node) => node.textContent === "Inventario")!
            .click(),
    );
    expect(container.querySelectorAll(".catalog-card")).toHaveLength(1);
    expect(container.textContent).toContain("Modelo B");
    expect(container.querySelector('input[aria-label="Buscar en el catálogo"]')).not.toBeNull();
});
it("opens a saved object fragment even if it belongs to a note", async () => {
    window.history.replaceState({}, "", "/#objeto-note");
    await act(async () => root.render(<CollectionPage />));
    expect(container.querySelector("dialog")?.textContent).toContain("Medir el lugar");
    expect(container.querySelector("dialog img")).toBeNull();
});
it("identifies a Inventario reference without claiming ownership in cards or details", async () => {
    const reference = catalogFixture({ provenance: "my-gear", ownership: "reference" });
    await act(async () =>
        root.render(
            <>
                <CollectionCard entry={reference} onOpen={() => {}} />
                <CollectionDetail entry={reference} onClose={() => {}} />
            </>,
        ),
    );
    expect(container.querySelector(".catalog-card-origin")?.textContent).toBe(
        "Inventario · Referencia",
    );
    expect(container.querySelector("dialog")?.textContent).toContain("Inventario · Referencia");
});
it.each(["Toyota Yaris S", " TOYOTA — Yaris  S ", "toyota.yaris-s"])(
    "does not repeat the brand/model identity from title %s or subtitle",
    async (title) => {
        const entry = catalogFixture({
            brand: "Toyota",
            model: "Yaris S",
            title,
            subtitle: "TOYOTA",
        });
        await act(async () =>
            root.render(
                <>
                    <CollectionCard entry={entry} onOpen={() => {}} />
                    <CollectionDetail entry={entry} onClose={() => {}} />
                </>,
            ),
        );
        expect(container.querySelector(".catalog-card-meta span")?.textContent).toBe("Toyota");
        expect(container.querySelector(".catalog-card h3")?.textContent).toBe("Yaris S");
        expect(container.querySelector(".catalog-card-caption > p")).toBeNull();
        expect(container.querySelector(".catalog-detail-brand")?.textContent).toBe("Toyota");
        expect(container.querySelector("dialog h2")?.textContent).toBe("Yaris S");
        expect(container.querySelectorAll(".detail-subtitle")).toHaveLength(0);
    },
);
it("keeps a distinct variant title and description in cards and details", async () => {
    const entry = catalogFixture({
        brand: "IKEA",
        model: "LISABO",
        title: "LISABO · Fresno",
        subtitle: "Silla de comedor",
    });
    await act(async () =>
        root.render(
            <>
                <CollectionCard entry={entry} onOpen={() => {}} />
                <CollectionDetail entry={entry} onClose={() => {}} />
            </>,
        ),
    );
    expect(container.querySelector(".catalog-card-caption > p")?.textContent).toBe(
        "LISABO · Fresno",
    );
    expect(
        [...container.querySelectorAll(".detail-subtitle")].map((node) => node.textContent),
    ).toEqual(["LISABO · Fresno", "Silla de comedor"]);
});
it.each([
    ["Galaxy S24", "Galaxy S24+"],
    ["Modelo 12", "Modelo 1.2"],
    ["RX8", "RX-8"],
    ["Modelo LR", "Modelo L/R"],
    ["Modelo 1 2", "Modelo 1 - 2"],
])("preserves meaningful punctuation between %s and %s", async (model, title) => {
    const entry = catalogFixture({ model, title, subtitle: title });
    await act(async () =>
        root.render(
            <>
                <CollectionCard entry={entry} onOpen={() => {}} />
                <CollectionDetail entry={entry} onClose={() => {}} />
            </>,
        ),
    );
    expect(container.querySelector(".catalog-card h3")?.textContent).toBe(model);
    expect(container.querySelector(".catalog-card-caption > p")?.textContent).toBe(title);
    expect(container.querySelector("dialog h2")?.textContent).toBe(model);
    expect(
        [...container.querySelectorAll(".detail-subtitle")].map((node) => node.textContent),
    ).toEqual([title]);
});
it("does not repeat a brand already contained in the heading", async () => {
    const entry = catalogFixture({
        brand: "IKEA",
        model: "IKEA LISABO",
        title: "Lisabo",
        subtitle: "Ikea Lisabo",
    });
    await act(async () =>
        root.render(
            <>
                <CollectionCard entry={entry} onOpen={() => {}} />
                <CollectionDetail entry={entry} onClose={() => {}} />
            </>,
        ),
    );
    expect(container.querySelector(".catalog-card h3")?.textContent).toBe("IKEA LISABO");
    expect(container.querySelector(".catalog-card-meta span")?.textContent).toBe("");
    expect(container.querySelector(".catalog-card-caption > p")).toBeNull();
    expect(container.querySelector(".catalog-detail-brand")).toBeNull();
    expect(container.querySelectorAll(".detail-subtitle")).toHaveLength(0);
});
it("preserves a legacy note title and descriptive subtitle", async () => {
    const entry = catalogFixture({
        kind: "note",
        brand: null,
        model: null,
        title: "Medidas",
        subtitle: "Medidas del living",
    });
    await act(async () =>
        root.render(
            <>
                <CollectionCard entry={entry} onOpen={() => {}} />
                <CollectionDetail entry={entry} onClose={() => {}} />
            </>,
        ),
    );
    expect(container.querySelector(".catalog-note h2")?.textContent).toBe("Medidas");
    expect(container.querySelector("dialog h2")?.textContent).toBe("Medidas");
    expect(container.querySelector(".detail-subtitle")?.textContent).toBe("Medidas del living");
});
it("keeps notes textual and reports retained imports alongside persisted purchases", async () => {
    state.stale = true;
    await act(async () =>
        root.render(
            <>
                <CollectionPage />
                <CollectionCard entry={fixtures[2]!} onOpen={() => {}} />
            </>,
        ),
    );
    expect(container.querySelector(".catalog-note img")).toBeNull();
    expect(container.textContent).toContain("Se conserva el catálogo anterior");
    expect(container.textContent).toContain("Los cambios de compra se guardan en Home");
});

it("switches gallery images without changing the model and keeps product/record attribution separate", async () => {
    const productSource = { title: "Fabricante · Modelo A", url: "https://example.com/product" };
    const entry = catalogFixture({
        productSource,
        images: [
            {
                path: "/media/front.webp",
                alt: "Vista frontal",
                source: productSource,
                role: "product",
            },
            {
                path: "/media/back.webp",
                alt: "Vista trasera",
                source: productSource,
                role: "product",
            },
        ],
    });
    await act(async () => root.render(<CollectionDetail entry={entry} onClose={() => {}} />));
    expect(container.querySelector(".catalog-gallery > .item-photo img")?.getAttribute("src")).toBe(
        "/media/front.webp",
    );
    await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Ver foto 2"]')!.click(),
    );
    expect(container.querySelector(".catalog-gallery > .item-photo img")?.getAttribute("src")).toBe(
        "/media/back.webp",
    );
    expect(container.querySelector("h2")?.textContent).toBe("Modelo A");
    expect(container.querySelector('a[href="https://example.com/product"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com/notion"]')).not.toBeNull();
});
