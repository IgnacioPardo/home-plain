import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
    onHomeUnauthorized,
    setHomeCsrfToken,
    readHomeSession,
    loginHome,
    logoutHome,
    type AuthSession,
} from "@repo/client";

export function useAuthSession() {
    const cache = useQueryClient();
    const [session, setSession] = useState<AuthSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const generation = useRef(0);
    const mutating = useRef(false);
    const loggingOut = useRef(false);
    const current = useRef<AuthSession | null>(null);
    const applySession = useCallback(
        (next: AuthSession | null, reason?: "logout") => {
            if (current.current?.csrfToken !== next?.csrfToken) {
                cache.clear();
                if (current.current) {
                    const change =
                        reason ??
                        (!next
                            ? "expired"
                            : current.current.username !== next.username ||
                                current.current.role !== next.role
                              ? "changed"
                              : "refreshed");
                    window.dispatchEvent(
                        new CustomEvent("home:session-cleared", { detail: { reason: change } }),
                    );
                }
            }
            current.current = next;
            setHomeCsrfToken(next?.csrfToken ?? null);
            setSession(next);
        },
        [cache],
    );
    const check = useCallback(async () => {
        if (mutating.current) return;
        const request = ++generation.current;
        try {
            const next = await readHomeSession();
            if (request === generation.current) {
                applySession(next);
                setError(null);
            }
        } catch {
            if (request === generation.current)
                setError("No se pudo comprobar la sesión. Volvé a intentar.");
        } finally {
            if (request === generation.current) setLoading(false);
        }
    }, [applySession]);
    useEffect(() => {
        void check();
        const unsubscribe = onHomeUnauthorized(() => {
            generation.current++;
            applySession(null, loggingOut.current ? "logout" : undefined);
            setLoading(false);
            setError("Tu sesión terminó. Volvé a iniciar sesión.");
        });
        const focus = () => {
            if (document.visibilityState !== "hidden") void check();
        };
        window.addEventListener("focus", focus);
        const timer = window.setInterval(focus, 60_000);
        return () => {
            generation.current++;
            unsubscribe();
            window.removeEventListener("focus", focus);
            window.clearInterval(timer);
        };
    }, [applySession, check]);
    const login = async (username: string, password: string) => {
        mutating.current = true;
        const request = ++generation.current;
        setBusy(true);
        setError(null);
        try {
            const next = await loginHome(username, password);
            if (request === generation.current) applySession(next);
        } catch (reason) {
            if (request === generation.current)
                setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");
        } finally {
            mutating.current = false;
            setBusy(false);
        }
    };
    const logout = async () => {
        mutating.current = true;
        loggingOut.current = true;
        const request = ++generation.current;
        setBusy(true);
        setError(null);
        try {
            await logoutHome(session?.csrfToken ?? "");
            if (request === generation.current) applySession(null, "logout");
        } catch {
            // A lost response may still have revoked the cookie. Check before
            // claiming logout failed or keeping private content on screen.
            try {
                const next = await readHomeSession();
                if (request === generation.current) {
                    applySession(next, next ? undefined : "logout");
                    if (next) setError("No se pudo cerrar la sesión. Volvé a intentar.");
                }
            } catch {
                if (request === generation.current)
                    setError("No se pudo cerrar la sesión. Volvé a intentar.");
            }
        } finally {
            loggingOut.current = false;
            mutating.current = false;
            setBusy(false);
        }
    };
    return { session, loading, busy, error, check, login, logout };
}
