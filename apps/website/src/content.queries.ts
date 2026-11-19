import { useQuery } from "@tanstack/react-query";
import { createHomeClient } from "@repo/client";

const client = createHomeClient();
export function useContentIndex() {
    return useQuery({
        queryKey: ["content", "index"],
        queryFn: ({ signal }) => client.content.index.query(undefined, { signal }),
        staleTime: 30_000,
        refetchInterval: (query) => (query.state.data?.state === "syncing" ? 5_000 : 300_000),
        refetchOnWindowFocus: "always",
        retry: 1,
    });
}
export function useContentDocument(id: string) {
    return useQuery({
        queryKey: ["content", "document", id],
        queryFn: ({ signal }) => client.content.document.query({ id }, { signal }),
        enabled: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),
        staleTime: 30_000,
        refetchInterval: (query) => (query.state.data?.state === "syncing" ? 5_000 : 300_000),
        refetchOnWindowFocus: "always",
        retry: 1,
    });
}
