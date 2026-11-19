import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { createHomeClient } from "@repo/client";

const client = createHomeClient();
const dashboardKey = ["shopping", "dashboard"];
export function useDashboard() {
    return useQuery({
        queryKey: dashboardKey,
        queryFn: ({ signal }) => client.shopping.dashboard.query(undefined, { signal }),
        refetchInterval: (query) => (query.state.data?.state === "syncing" ? 5_000 : 60_000),
        staleTime: 30_000,
        retry: 1,
    });
}
export function useRefresh() {
    const cache = useQueryClient();
    return useMutation({
        mutationFn: () => client.shopping.refresh.mutate(),
        // A refresh response may arrive after a later purchase save. Read current
        // server state instead of installing the refresh's older snapshot.
        onSuccess: () => cache.invalidateQueries({ queryKey: dashboardKey }),
    });
}
export function useCollection() {
    return useQuery({
        queryKey: ["collection"],
        queryFn: () => client.collection.query(),
        staleTime: 30_000,
        refetchInterval: 60_000,
        retry: 1,
    });
}
export function useCollectionStatus() {
    return useQuery({
        queryKey: ["collection-status"],
        queryFn: () => client.collectionStatus.query(),
        staleTime: 30_000,
        refetchInterval: 60_000,
        retry: 1,
    });
}
export function useMoodboard() {
    return useQuery({
        queryKey: ["moodboard"],
        queryFn: () => client.moodboard.query(),
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: 1,
    });
}

export function useSetPurchased() {
    const cache = useQueryClient();
    return useMutation({
        mutationFn: async (input: Parameters<typeof client.shopping.setPurchased.mutate>[0]) => {
            try {
                return await client.shopping.setPurchased.mutate(input);
            } catch (error) {
                throw new Error(
                    error instanceof TRPCClientError && error.data?.code
                        ? error.message
                        : "No se pudo confirmar el cambio. Actualizá la lista antes de intentarlo de nuevo.",
                );
            }
        },
        retry: false,
        onMutate: () => cache.cancelQueries({ queryKey: dashboardKey }),
        onSuccess: async (result) => {
            await cache.cancelQueries({ queryKey: dashboardKey });
            cache.setQueryData(dashboardKey, result);
        },
        // A lost response can still mean the write reached the database. Re-read before another attempt.
        onError: () => cache.invalidateQueries({ queryKey: dashboardKey }),
    });
}
