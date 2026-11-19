// Feedback behavior has dedicated form and HTTP coverage.
vi.mock("./feedback", () => ({ FeedbackPanel: () => null }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ContentBlock, ContentDocumentResult, ContentIndex, ContentText } from "@repo/client";
import { DocumentPage, Documents } from "./documents";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const part = (text: string, href: string | null = null): ContentText => ({
    text,
    href,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
});
const block = (
    n: number,
    type: ContentBlock["type"],
    text: ContentText[] = [],
    extra: Partial<ContentBlock> = {},
): ContentBlock => ({
    id: id(n),
    type,
    text,
    children: [],
    cells: [],
    checked: false,
    columnHeader: false,
    rowHeader: false,
    targetId: null,
    ...extra,
});
let documentResult: ContentDocumentResult;
let index: ContentIndex;
let isError = false;
let documentId = id(1);
let locationHash = "";
const refetch = vi.fn();
vi.mock("./content.queries", () => ({
    useContentIndex: () => ({ data: index, isPending: false, isError, isFetching: false, refetch }),
    useContentDocument: () => ({
        data: documentResult,
        isPending: false,
        isError,
        isFetching: false,
        refetch,
    }),
}));
vi.mock("@tanstack/react-router", () => ({
    useParams: () => ({ documentId }),
    useLocation: () => locationHash,
    Link: ({
        to,
        params,
        children,
        ...props
    }: {
        to: string;
        params?: { documentId: string };
        children: React.ReactNode;
    }) => (
        <a href={to.replace("$documentId", params?.documentId ?? "")} {...props}>
            {children}
        </a>
    ),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    isError = false;
    documentId = id(1);
    locationHash = "";
    refetch.mockClear();
    index = {
        configured: true,
        state: "live",
        syncedAt: "2026-11-16T12:00:00Z",
        documents: [
            { id: id(1), parentId: null, title: "Home", searchText: "Home" },
            { id: id(2), parentId: id(1), title: "Criterios de vivienda", searchText: "Criterios" },
        ],
    };
    documentResult = {
        configured: true,
        state: "live",
        syncedAt: index.syncedAt,
        document: {
            id: id(1),
            parentId: null,
            title: "Home",
            url: "https://www.notion.so/example",
            blocks: [
                block(10, "table_of_contents"),
                block(11, "heading_1", [part("Condiciones")], {
                    children: [block(20, "paragraph", [part("Detalle de condiciones")])],
                }),
                block(12, "paragraph", [
                    part("Leer criterios", `https://www.notion.so/${id(2).replaceAll("-", "")}`),
                    part("Texto <script>alert(1)</script>"),
                ]),
                block(13, "numbered_list_item", [part("Primero")]),
                block(14, "numbered_list_item", [part("Segundo")]),
                block(15, "table", [], {
                    columnHeader: true,
                    children: [
                        block(16, "table_row", [], {
                            cells: [[part("Objeto")], [part("Condición")]],
                        }),
                        block(17, "table_row", [], {
                            cells: [[part("Mesa")], [part("Medir el ambiente")]],
                        }),
                    ],
                }),
                block(18, "callout", [part("Confirmado")]),
                block(19, "unsupported"),
            ],
        },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

it("reads nested tables, grouped lists, callouts and table-of-contents with internal document links", async () => {
    await act(async () => root.render(<DocumentPage />));
    expect(container.querySelector("h1")?.textContent).toBe("Home");
    expect(container.textContent).toContain("Detalle de condiciones");
    expect(container.querySelectorAll("table tr")).toHaveLength(2);
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(2);
    expect(container.querySelector("table")?.textContent).toContain("Medir el ambiente");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector('a[href="/documentos/' + id(2) + '"]')?.textContent).toBe(
        "Leer criterios",
    );
    expect(container.querySelector('nav a[href="#block-' + id(11) + '"]')).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("Texto <script>alert(1)</script>");
    expect(container.querySelector(".document-callout")?.textContent).toBe("Confirmado");
    expect(container.textContent).toContain("Este bloque todavía no se puede mostrar");
    expect(container.querySelector(".document-table")?.getAttribute("tabindex")).toBe("0");
});

it("shows an invalid document link instead of a perpetual loading state", async () => {
    documentId = "not-a-document";
    await act(async () => root.render(<DocumentPage />));
    expect(container.textContent).toContain("El enlace no corresponde");
    expect(container.textContent).not.toContain("Cargando documento");
    expect(container.querySelector("article")).toBeNull();
});

it("scrolls a section link after its document has rendered", async () => {
    locationHash = `block-${id(11)}`;
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
        await act(async () => root.render(<DocumentPage />));
        expect(scrollIntoView).toHaveBeenCalledOnce();
        expect(scrollIntoView.mock.instances[0]).toBe(container.querySelector("h2"));
    } finally {
        HTMLElement.prototype.scrollIntoView = original;
    }
});

it("keeps the last document readable while reporting a failed refresh", async () => {
    isError = true;
    await act(async () => root.render(<DocumentPage />));
    expect(container.textContent).toContain("Última copia disponible");
    expect(container.querySelector("table")?.textContent).toContain("Mesa");
});

it("shows initial synchronization without claiming that configured documents are absent", async () => {
    index = { configured: true, state: "syncing", syncedAt: null, documents: [] };
    documentResult = { configured: true, state: "syncing", syncedAt: null, document: null };
    await act(async () => root.render(<Documents />));
    expect(container.textContent).toContain("Actualizando documentos");
    expect(container.textContent).not.toContain("No hay una copia");
    await act(async () => root.render(<DocumentPage />));
    expect(container.textContent).toContain("Cargando documento");
    expect(container.textContent).not.toContain("Documento no disponible");
});

it("does not mistake a missing document for an empty successful document", async () => {
    documentResult = { configured: false, state: "unconfigured", syncedAt: null, document: null };
    await act(async () => root.render(<DocumentPage />));
    expect(container.textContent).toContain("Documento no disponible");
    expect(container.querySelector("article")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(refetch).toHaveBeenCalledOnce();
});

it("lists shared documents in-app and excludes the old full inventory entry", async () => {
    await act(async () => root.render(<Documents />));
    expect(container.querySelectorAll('a[href^="/documentos/"]')).toHaveLength(2);
    expect(container.textContent).toContain("Criterios de vivienda");
    expect(container.textContent).not.toContain("Inventario");
    expect(container.textContent).not.toContain("Abrir en Notion");
});
