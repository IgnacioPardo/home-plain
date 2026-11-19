import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AgentRun } from "@repo/client";
import { AgentPage } from "./agent";
let owner = true;
let query: {
    data: { configured: boolean; runs: AgentRun[] };
    isPending: boolean;
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
};
const start = {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: new Error("No se pudo confirmar"),
};
const cancel = { mutate: vi.fn(), isPending: false, isError: false, error: null };
const decide = { mutate: vi.fn(), isPending: false, isError: false, error: null };
vi.mock("./auth", () => ({ useSession: () => ({ role: owner ? "owner" : "commenter" }) }));
vi.mock("./agent.queries", () => ({
    useAgentRuns: () => query,
    useStartAgent: () => start,
    useCancelAgent: () => cancel,
    useDecideAgent: () => decide,
}));
vi.mock("./ui", () => ({
    Heading: ({ title, action }: { title: string; action: ReactNode }) => (
        <header>
            <h1>{title}</h1>
            {action}
        </header>
    ),
}));
vi.mock("@tanstack/react-router", () => ({
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
let container: HTMLDivElement;
let root: Root;
const run: AgentRun = {
    id: "00000000-0000-4000-8000-000000000001",
    room: "Living",
    goal: "Planificar una mudanza",
    status: "succeeded",
    progress: "review",
    attempts: 1,
    proposal: {
        summary: "Propuesta de prueba",
        steps: [{ title: "Medir", detail: "Revisar el espacio disponible", evidenceIds: [] }],
    },
    decision: "pending",
    noteId: null,
    issue: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
};
beforeEach(() => {
    owner = true;
    query = {
        data: { configured: true, runs: [] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    };
    vi.clearAllMocks();
    start.isError = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});
async function render() {
    await act(async () => root.render(<AgentPage />));
}
function button(text: string) {
    return [...container.querySelectorAll("button")].find(
        (element) => element.textContent === text,
    )!;
}
async function fill(selector: string, value: string) {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            element.tagName === "TEXTAREA"
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype,
            "value",
        )!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
it("shows honest unconfigured and failed states while allowing existing proposals to be read", async () => {
    query.data = { configured: false, runs: [run] };
    await render();
    expect(container.textContent).toContain("todavía no está configurado");
    expect(container.textContent).toContain("Propuesta de prueba");
    expect(button("Generar propuesta").disabled).toBe(true);
    query.isError = true;
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "No se pudieron cargar",
    );
    expect(start.mutate).not.toHaveBeenCalled();
});
it("reuses the request identifier after an ambiguous submit failure and keeps the draft", async () => {
    await render();
    await fill("input", "Living");
    await fill("textarea", "Preparar los muebles para la mudanza");
    const submit = async () =>
        act(async () => {
            container
                .querySelector("form")!
                .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    await submit();
    start.isError = true;
    await render();
    await submit();
    expect(start.mutate).toHaveBeenCalledTimes(2);
    expect(start.mutate.mock.calls[0]![0]).toEqual(start.mutate.mock.calls[1]![0]);
    expect(container.querySelector("textarea")!.value).toBe("Preparar los muebles para la mudanza");
    expect(container.textContent).toContain("Revisá las ejecuciones");
});
it("requires an explicit owner action before saving or discarding a proposal", async () => {
    query.data.runs = [run];
    await render();
    expect(decide.mutate).not.toHaveBeenCalled();
    await act(async () => button("Guardar como nota").click());
    expect(decide.mutate).toHaveBeenCalledExactlyOnceWith({ id: run.id, decision: "applied" });
    expect(container.textContent).not.toContain("Guardado como nota.");
    owner = false;
    await render();
    expect(container.querySelector("form")).toBeNull();
    expect(button("Guardar como nota")).toBeUndefined();
    expect(button("Descartar propuesta")).toBeUndefined();
    expect(container.textContent).toContain("Propuesta de prueba");
});
it("offers cancellation while waiting for confirmed server state", async () => {
    query.data.runs = [{ ...run, status: "running", progress: "planning", proposal: null }];
    await render();
    await act(async () => button("Cancelar ejecución").click());
    expect(cancel.mutate).toHaveBeenCalledExactlyOnceWith(run.id);
    expect(container.textContent).toContain("Preparando el plan…");
    expect(container.textContent).not.toContain("Cancelado");
});
