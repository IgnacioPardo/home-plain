import { useEffect, useRef, useState } from "react";

/** Resolve a saved website context link only against this view's loaded catalog. */
export function useContextLink<T extends { id: string }>(
    prefix: string,
    entries: readonly T[],
    open: (entry: T) => void,
) {
    const [hash, setHash] = useState(() => window.location.hash);
    const handled = useRef<string | null>(null);
    const currentHash = useRef(hash);
    useEffect(() => {
        const changed = () => {
            const next = window.location.hash;
            if (next === currentHash.current) return;
            currentHash.current = next;
            handled.current = null;
            setHash(next);
        };
        window.addEventListener("hashchange", changed);
        return () => window.removeEventListener("hashchange", changed);
    }, []);
    useEffect(() => {
        if (handled.current === hash || !hash.startsWith(`#${prefix}-`)) return;
        const id = hash.slice(prefix.length + 2);
        const entry = entries.find((candidate) => candidate.id === id);
        if (!entry) return;
        handled.current = hash;
        open(entry);
        document.getElementById(`${prefix}-${id}`)?.scrollIntoView({ block: "start" });
    }, [hash, prefix, entries, open]);
}
