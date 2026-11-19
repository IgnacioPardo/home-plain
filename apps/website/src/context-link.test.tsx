import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useContextLink } from "./context-link";

it("opens a known target after delayed catalog loading, even without a rendered card, and never reopens on refetch", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const original = window.location.href;
    window.history.replaceState(null, "", "#referencia-hidden-reference");
    const open = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    function Probe({ entries }: { entries: { id: string }[] }) {
        useContextLink("referencia", entries, open);
        return <p>No cards on this page</p>;
    }
    try {
        await act(async () => root.render(<Probe entries={[]} />));
        expect(open).not.toHaveBeenCalled();
        await act(async () => root.render(<Probe entries={[{ id: "hidden-reference" }]} />));
        expect(open).toHaveBeenCalledExactlyOnceWith({ id: "hidden-reference" });
        await act(async () => root.render(<Probe entries={[{ id: "hidden-reference" }]} />));
        expect(open).toHaveBeenCalledTimes(1);
        await act(async () => {
            window.history.replaceState(null, "", "#referencia-unknown");
            window.dispatchEvent(new Event("hashchange"));
        });
        expect(open).toHaveBeenCalledTimes(1);
        await act(async () => {
            window.history.replaceState(null, "", "#referencia-hidden-reference");
            window.dispatchEvent(new Event("hashchange"));
        });
        expect(open).toHaveBeenCalledTimes(2);
    } finally {
        await act(async () => root.unmount());
        window.history.replaceState(null, "", original);
    }
});
