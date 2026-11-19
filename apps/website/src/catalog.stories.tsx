/** Dev-only synthetic stories. Open /stories.html in Vite; never part of the production entry. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from "@tanstack/react-router";
import { CollectionPage } from "./collection";
import { ChecklistPage } from "./checklist";
import { PlanPage } from "./plan";
import { MoodboardPage } from "./moodboard";
import { RoomsPage } from "./rooms";
import { NotesPage, SourcesPage } from "./library";
import { Shell } from "./shell";
import { catalogFixture } from "./catalog-fixtures";
import type { CollectionEntry, ShoppingItem } from "@repo/client";
import "./styles.css";

export const catalogStories = {
    gallery: "Catálogo con objetos propios y referencias",
    missing: "Sin importación; lista de compras disponible",
    stale: "Última importación válida conservada",
    identity: "Identidad repetida y variante distinta",
} as const;
const products = [
    [
        "desk-lamp",
        "Lámpara de escritorio",
        "Modelo A",
        "Trabajo",
        "Trabajo",
        "https://example.com/lamp",
    ],
    [
        "dining-chair",
        "Silla de comedor",
        "Modelo B",
        "Hogar",
        "Living",
        "https://example.com/chair",
    ],
    ["desk", "Escritorio", "Modelo C", "Trabajo", "Trabajo", "https://example.com/desk"],
    [
        "work-chair",
        "Silla de trabajo",
        "Modelo D",
        "Trabajo",
        "Trabajo",
        "https://example.com/work-chair",
    ],
    ["sofa", "Sofá", "Modelo E", "Hogar", "Living", "https://example.com/sofa"],
    ["dining-table", "Mesa de comedor", "Modelo F", "Hogar", "Living", "https://example.com/table"],
];
export const storyEntries: CollectionEntry[] = products.map(
    ([id, title, model, category, room, url], index) => {
        const source = { title: "Fuente de ejemplo", url: url! };
        return catalogFixture({
            id: `fixture-${id}`,
            title: title!,
            model: model!,
            category: category!,
            brand: "Ejemplo",
            image: null,
            imageAlt: title!,
            imageSource: null,
            productSource: source,
            images: [],
            rooms: [room!],
            shoppingItemId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            shoppingRelation: index === 0 ? "contextual" : "exact",
            provenance: index === 0 ? "my-gear" : "home-reference",
            ownership: index === 0 ? "owned" : "reference",
            kind: index === 0 ? "object" : "reference",
            body: "Registro sintético para verificar la interfaz; no representa una decisión personal.",
            materials: [],
            reason:
                index === 0
                    ? null
                    : "Comparar dimensiones y terminación antes de definir la compra.",
        });
    },
);
const items: ShoppingItem[] = storyEntries.map((entry, index) => ({
    id: entry.shoppingItemId!,
    name: entry.title,
    room: entry.rooms[0]!,
    priority: index % 2 ? "Esencial" : "Segunda etapa",
    status: "En lista",
    origin: index % 2 ? "Confirmado" : "Propuesto",
    url: "https://example.com/shopping",
    initialQuantity: "1",
    targetQuantity: "1",
    quality: "Verificar la terminación y las medidas.",
    condition: "Medir el espacio disponible antes de comprar.",
    notes: "Datos sintéticos de prueba.",
    estimatedPriceArs: null,
    reference: null,
}));

function StoryFrame({ state }: { state: string }) {
    const cache = new QueryClient({
        defaultOptions: { queries: { enabled: false, retry: false } },
    });
    cache.setQueryData(
        ["collection"],
        state === "missing"
            ? null
            : {
                  version: 2,
                  source: "import",
                  importedAt: "2026-11-18T15:00:00Z",
                  entries: [
                      ...storyEntries.map((entry) =>
                          state === "identity" && entry.id === "fixture-dining-chair"
                              ? { ...entry, title: "Ejemplo — Modelo B", subtitle: "Ejemplo" }
                              : state === "identity" && entry.id === "fixture-sofa"
                                ? {
                                      ...entry,
                                      title: "Sofá de tres cuerpos",
                                      subtitle: "Tapizado gris",
                                  }
                                : entry,
                      ),
                      catalogFixture({
                          id: "fixture-note",
                          kind: "note",
                          title: "Medidas del espacio",
                          body: "Registrar las medidas antes de decidir los muebles. Esta es una nota sintética.",
                          image: null,
                          images: [],
                          model: null,
                      }),
                  ],
              },
    );
    cache.setQueryData(["collection-status"], {
        state: state === "stale" ? "stale" : state === "missing" ? "missing" : "ready",
        importedAt: "2026-11-18T15:00:00Z",
        issue: null,
    });
    cache.setQueryData(["shopping", "dashboard"], {
        configured: false,
        state: "offline",
        issue: "not_configured",
        snapshot: {
            version: 1,
            source: "import",
            syncedAt: "2026-11-18T15:00:00Z",
            dataSourceId: "00000000-0000-4000-8000-000000000000",
            items,
        },
    });
    cache.setQueryData(["content", "index"], {
        configured: false,
        state: "unconfigured",
        syncedAt: null,
        documents: [],
    });
    cache.setQueryData(["moodboard"], null);
    const feedback = {
        configured: false,
        canCreate: false,
        state: "unconfigured",
        issue: "not_configured",
        snapshot: null,
    };
    for (const entry of storyEntries)
        cache.setQueryData(["feedback", "collection", entry.id], feedback);
    cache.setQueryData(["feedback", "notes", "all"], feedback);
    const root = createRootRoute({ component: Shell });
    const router = createRouter({
        history: createMemoryHistory({
            initialEntries: [new URLSearchParams(location.search).get("path") ?? "/"],
        }),
        routeTree: root.addChildren([
            createRoute({ getParentRoute: () => root, path: "/", component: CollectionPage }),
            createRoute({
                getParentRoute: () => root,
                path: "/coleccion",
                component: CollectionPage,
            }),
            createRoute({ getParentRoute: () => root, path: "/lista", component: ChecklistPage }),
            createRoute({ getParentRoute: () => root, path: "/compras", component: PlanPage }),
            createRoute({ getParentRoute: () => root, path: "/ambientes", component: RoomsPage }),
            createRoute({
                getParentRoute: () => root,
                path: "/referencias",
                component: MoodboardPage,
            }),
            createRoute({ getParentRoute: () => root, path: "/notas", component: NotesPage }),
            createRoute({ getParentRoute: () => root, path: "/fuentes", component: SourcesPage }),
        ]),
    });
    return (
        <QueryClientProvider client={cache}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}
function StoryViewport() {
    const params = new URLSearchParams(location.search);
    const width = Number(params.get("width")) || 1440;
    const height = Number(params.get("height")) || 1000;
    params.set("frame", "1");
    return (
        <div style={{ padding: 0, background: "#e5e5e5", minWidth: width, minHeight: height }}>
            <p style={{ display: "none" }}>
                Datos sintéticos · {width} × {height}
            </p>
            <iframe
                title={`Home de prueba ${width}px`}
                src={`/stories.html?${params}${params.get("detail") ? `#objeto-${params.get("detail")}` : ""}`}
                width={width}
                height={height}
                style={{ border: 0, display: "block", background: "white" }}
            />
        </div>
    );
}
if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    if (params.get("theme")) localStorage.setItem("home-theme", params.get("theme")!);
    document.documentElement.dataset.theme = params.get("theme") ?? "light";
    const container = document.getElementById("stories");
    if (container)
        createRoot(container).render(
            params.has("frame") ? (
                <StoryFrame state={params.get("state") ?? "gallery"} />
            ) : (
                <StoryViewport />
            ),
        );
}
