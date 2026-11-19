import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { Shell } from "./shell";
import { ChecklistPage } from "./checklist";
import { CollectionPage } from "./collection";
import { PlanPage, validatePlanSearch } from "./plan";
import { NotesPage, SourcesPage } from "./library";
import { RoomsPage } from "./rooms";
import { MoodboardPage } from "./moodboard";
import { DocumentPage } from "./documents";
import { AgentPage } from "./agent";
import { AuthGate } from "./auth";
import "./styles.css";

const queryClient = new QueryClient();
const root = createRootRoute({
    component: Shell,
    notFoundComponent: () => (
        <div className="empty">
            Esta página todavía no existe. <a href="/">Volver a Home</a>
        </div>
    ),
});
const routes = [
    createRoute({ getParentRoute: () => root, path: "/agente", component: AgentPage }),
    createRoute({ getParentRoute: () => root, path: "/lista", component: ChecklistPage }),
    createRoute({ getParentRoute: () => root, path: "/referencias", component: MoodboardPage }),
    createRoute({ getParentRoute: () => root, path: "/", component: CollectionPage }),
    createRoute({
        getParentRoute: () => root,
        path: "/compras",
        component: PlanPage,
        validateSearch: validatePlanSearch,
    }),
    createRoute({ getParentRoute: () => root, path: "/coleccion", component: CollectionPage }),
    createRoute({ getParentRoute: () => root, path: "/ambientes", component: RoomsPage }),
    createRoute({ getParentRoute: () => root, path: "/notas", component: NotesPage }),
    createRoute({
        getParentRoute: () => root,
        path: "/documentos/$documentId",
        component: DocumentPage,
    }),
    createRoute({ getParentRoute: () => root, path: "/fuentes", component: SourcesPage }),
    createRoute({ getParentRoute: () => root, path: "/moodboard", component: MoodboardPage }),
];
const router = createRouter({ routeTree: root.addChildren(routes) });
declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
const container = document.getElementById("app");
if (container)
    createRoot(container).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <AuthGate>
                    <RouterProvider router={router} />
                </AuthGate>
            </QueryClientProvider>
        </StrictMode>,
    );
