import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDashboard, useRefresh, useSetPurchased } from "./home.queries";

const transport = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), refresh: vi.fn() }));
vi.mock("@repo/client", () => ({
    createHomeClient: () => ({
        shopping: {
            dashboard: { query: transport.query },
            setPurchased: { mutate: transport.mutate },
            refresh: { mutate: transport.refresh },
        },
    }),
}));
const pending = {
    configured: true,
    state: "live",
    issue: null,
    snapshot: {
        version: 1,
        source: "api",
        dataSourceId: "00000000-0000-4000-8000-000000000009",
        syncedAt: "2026-11-12T12:00:00Z",
        items: [{ id: "00000000-0000-4000-8000-000000000001", status: "En lista" }],
    },
};
const saved = {
    ...pending,
    snapshot: {
        ...pending.snapshot,
        items: [{ ...pending.snapshot.items[0], status: "Comprado" }],
    },
};
const input = {
    id: pending.snapshot.items[0]!.id,
    purchased: true,
    expectedStatus: "En lista",
    expectedVersion: 0,
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function Probe() {
    const query = useDashboard();
    const save = useSetPurchased();
    const refresh = useRefresh();
    return (
        <>
            <p>{query.data?.snapshot?.items[0]?.status}</p>
            <button onClick={() => save.mutate(input)}>Save</button>
            <button onClick={() => refresh.mutate()}>Refresh</button>
            {save.isError && <p>Unconfirmed write</p>}
        </>
    );
}
let container: HTMLDivElement;
let root: Root;
let cache: QueryClient;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    transport.query.mockResolvedValue(pending);
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
});
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
}
async function mount() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={cache}>
                <Probe />
            </QueryClientProvider>,
        ),
    );
    await settle();
}
it("does not let a GET started before or during a save overwrite confirmed completion", async () => {
    await mount();
    const oldGet = deferred<typeof pending>();
    const concurrentGet = deferred<typeof pending>();
    const write = deferred<typeof saved>();
    let oldSignal: AbortSignal | undefined;
    let concurrentSignal: AbortSignal | undefined;
    transport.query.mockImplementationOnce((_input, options) => {
        oldSignal = options.signal;
        return oldGet.promise;
    });
    void cache.refetchQueries({ queryKey: ["shopping", "dashboard"] });
    transport.mutate.mockReturnValueOnce(write.promise);
    await act(async () => container.querySelector("button")!.click());
    expect(oldSignal?.aborted).toBe(true);
    expect(container.querySelector("p")?.textContent).toBe("En lista");
    transport.query.mockImplementationOnce((_input, options) => {
        concurrentSignal = options.signal;
        return concurrentGet.promise;
    });
    void cache.refetchQueries({ queryKey: ["shopping", "dashboard"] });
    await act(async () => write.resolve(saved));
    await settle();
    expect(concurrentSignal?.aborted).toBe(true);
    await act(async () => {
        oldGet.resolve(pending);
        concurrentGet.resolve(pending);
    });
    await settle();
    expect(container.querySelector("p")?.textContent).toBe("Comprado");
    expect(transport.mutate).toHaveBeenCalledExactlyOnceWith(input);
});
it("re-reads the database after an ambiguous failure without retrying the write", async () => {
    await mount();
    transport.mutate.mockRejectedValueOnce(new Error("Lost response"));
    transport.query.mockResolvedValueOnce(saved);
    await act(async () => container.querySelector("button")!.click());
    await settle();
    expect(transport.mutate).toHaveBeenCalledTimes(1);
    expect(container.querySelector("p")?.textContent).toBe("Comprado");
    expect(container.textContent).toContain("Unconfirmed write");
});

it("does not let a late manual refresh response undo a confirmed checkbox save", async () => {
    await mount();
    const refresh = deferred<typeof pending>();
    transport.refresh.mockReturnValueOnce(refresh.promise);
    await act(async () => container.querySelectorAll("button")[1]!.click());
    transport.mutate.mockResolvedValueOnce(saved);
    await act(async () => container.querySelector("button")!.click());
    await settle();
    expect(container.querySelector("p")?.textContent).toBe("Comprado");
    transport.query.mockResolvedValue(saved);
    await act(async () => refresh.resolve(pending));
    await settle();
    expect(container.querySelector("p")?.textContent).toBe("Comprado");
    expect(transport.query).toHaveBeenCalledTimes(2);
});
