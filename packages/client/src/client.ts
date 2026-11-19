import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@repo/backend";

let csrfToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();
export function setHomeCsrfToken(token: string | null) {
    csrfToken = token;
}
export function onHomeUnauthorized(listener: () => void) {
    unauthorizedListeners.add(listener);
    return () => {
        unauthorizedListeners.delete(listener);
    };
}
export function createHomeClient(url = "/trpc") {
    return createTRPCClient<AppRouter>({
        links: [
            httpBatchLink({
                url,
                transformer: superjson,
                headers: () => (csrfToken ? { "x-csrf-token": csrfToken } : {}),
                fetch: async (input, init) => {
                    const requestToken = new Headers(init?.headers).get("x-csrf-token");
                    const response = await fetch(input, { ...init, credentials: "same-origin" });
                    if (response.status === 401 && requestToken === csrfToken)
                        for (const listener of unauthorizedListeners) listener();
                    return response;
                },
            }),
        ],
    });
}
