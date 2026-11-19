// Feedback has separate query/HTTP and form tests. These tests isolate the existing page behavior.
vi.mock("./feedback", () => ({ FeedbackPanel: () => null, FeedbackNotes: () => null }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MoodboardSnapshot } from "@repo/client";
import { MoodboardPage } from "./moodboard";
import { ThemeToggle } from "./theme";
import { NotesPage, SourcesPage } from "./library";
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from "@tanstack/react-router";

let snapshot: MoodboardSnapshot | null;
vi.mock("./content.queries", () => ({
    useContentIndex: () => ({
        data: { documents: [], state: "unconfigured", syncedAt: null },
        isPending: false,
        isError: false,
    }),
}));
vi.mock("./home.queries", () => ({
    useMoodboard: () => ({ data: snapshot, isPending: false, isError: false }),
    useCollection: () => ({ data: null, isPending: false, isError: false }),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
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
    snapshot = {
        version: 1,
        status: "exploratory",
        importedAt: "2026-11-12T13:00:00Z",
        source: {
            title: "Test atlas",
            url: "https://example.com/atlas",
            conversation: "https://example.com/chat",
            sha256: "a".repeat(64),
        },
        references: Array.from({ length: 50 }, (_, index) => ({
            id: index.toString(16).padStart(14, "0"),
            title: `Reference ${index}`,
            projectKey: `https://example.com/project-${Math.floor(index / 2)}`,
            source: `https://example.com/project-${Math.floor(index / 2)}`,
            publisher: "Publisher",
            styles: ["Direction"],
            rooms: [index % 2 === 0 ? "Living" : "Estudio"],
            objects: ["Mesa"],
            note: "Imported note",
            quality: "editorial",
            palette: ["#123456"],
            hero: index % 2 === 0,
            image: null,
            thumbnail: "/media/atlas-abcdef01234567.jpg",
        })),
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
});
async function render() {
    await act(async () =>
        root.render(
            <>
                <ThemeToggle />
                <MoodboardPage />
            </>,
        ),
    );
}
function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent === label || node.getAttribute("aria-label") === label,
    )!;
}
function cards() {
    return container.querySelectorAll(".moodboard-card");
}
async function click(node: HTMLElement) {
    await act(async () => node.click());
}

it("preserves filtered browsing and dialog focus restoration in the shared dark theme", async () => {
    await render();
    const room = container.querySelectorAll("select")[1]!;
    await act(async () => {
        room.value = "Estudio";
        room.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(cards()).toHaveLength(25);
    await click(container.querySelector<HTMLButtonElement>(".theme-toggle")!);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(room.value).toBe("Estudio");
    const opener = button("Ver Reference 1");
    opener.focus();
    await click(opener);
    expect(container.querySelector("dialog")?.textContent).toContain("Vista 2 de 2");
    expect(container.querySelector("dialog img")?.getAttribute("src")).toBe(
        "/media/atlas-abcdef01234567.jpg",
    );
    expect(container.querySelector("dialog")?.textContent).toContain("Reference 1");
    await click(button("Vista anterior"));
    expect(container.querySelector("dialog")?.textContent).toContain("Vista 1 de 2");
    expect(container.querySelector("dialog a")?.getAttribute("href")).toBe(
        "https://example.com/project-0",
    );
    await click(button("Cerrar"));
    expect(document.activeElement).toBe(opener);
    expect(cards()).toHaveLength(25);
});

it("paginates all views and resets the page when filters change", async () => {
    await render();
    expect(cards()).toHaveLength(25);
    await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(cards()).toHaveLength(48);
    await click(button("Ver más referencias"));
    expect(cards()).toHaveLength(50);
    const room = container.querySelectorAll("select")[1]!;
    await act(async () => {
        room.value = "Estudio";
        room.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(cards()).toHaveLength(25);
    await click(button("Limpiar filtros"));
    expect(cards()).toHaveLength(25);
    await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(cards()).toHaveLength(48);
});

it("shows an unconfigured state without external links or invented totals", async () => {
    snapshot = null;
    await render();
    expect(container.textContent).toContain("No hay referencias importadas.");
    expect(container.querySelector("a")).toBeNull();
    expect(cards()).toHaveLength(0);
    expect(container.textContent).not.toContain("publicaciones");
});

it.each(["/notas", "/fuentes"])(
    "retains an in-memory theme when navigating from %s with storage blocked",
    async (from) => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        const layout = createRootRoute({
            component: () => (
                <>
                    <ThemeToggle />
                    <Outlet />
                </>
            ),
        });
        const router = createRouter({
            routeTree: layout.addChildren([
                createRoute({ getParentRoute: () => layout, path: "/notas", component: NotesPage }),
                createRoute({
                    getParentRoute: () => layout,
                    path: "/fuentes",
                    component: SourcesPage,
                }),
                createRoute({
                    getParentRoute: () => layout,
                    path: "/referencias",
                    component: MoodboardPage,
                }),
            ]),
            history: createMemoryHistory({ initialEntries: [from] }),
        });
        await act(async () => {
            await router.load();
            root.render(<RouterProvider router={router} />);
        });
        await click(container.querySelector<HTMLButtonElement>(".theme-toggle")!);
        expect(document.documentElement.dataset.theme).toBe("dark");
        await click(container.querySelector<HTMLAnchorElement>('a[href="/referencias"]')!);
        await act(async () => {
            await router.load();
        });
        expect(container.querySelector("h1")?.textContent).toBe("Referencias");
        expect(router.state.location.pathname).toBe("/referencias");
        expect(document.documentElement.dataset.theme).toBe("dark");
    },
);

it("separates Pinterest from the prior atlas and preserves old reference links", async () => {
    snapshot!.references.push({
        ...snapshot!.references[0]!,
        id: "eeeeeeeeeeeeee",
        title: "Referencia de Pinterest",
        collection: "pinterest",
        projectKey: "https://example.com/pin",
        source: "https://example.com/pin",
    });
    await render();
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain("Referencia de Pinterest");
    await click(button("Atlas"));
    expect(cards()).toHaveLength(25);
    await click(button("Pinterest"));
    expect(cards()).toHaveLength(1);
    await act(async () => {
        window.location.hash = "referencia-00000000000001";
        window.dispatchEvent(new Event("hashchange"));
    });
    expect(container.querySelector("dialog")?.textContent).toContain("Reference 1");
    expect(cards()).toHaveLength(25);
    window.history.replaceState({}, "", "/");
});
