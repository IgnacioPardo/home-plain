import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createHomeClient, type StartAgent } from "@repo/client";
const client = createHomeClient();
const key = ["agent-runs"];
export function useAgentRuns() {
    return useQuery({
        queryKey: key,
        queryFn: ({ signal }) => client.agent.list.query(undefined, { signal }),
        refetchInterval: (query) =>
            query.state.data?.runs.some(
                (run) => run.status === "queued" || run.status === "running",
            )
                ? 2000
                : false,
        retry: 1,
        refetchOnWindowFocus: true,
    });
}
export function useStartAgent() {
    const cache = useQueryClient();
    return useMutation({
        mutationFn: (input: StartAgent) => client.agent.start.mutate(input),
        retry: false,
        onSettled: () => cache.invalidateQueries({ queryKey: key }),
    });
}
export function useCancelAgent() {
    const cache = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => client.agent.cancel.mutate({ id }),
        retry: false,
        onSettled: () => cache.invalidateQueries({ queryKey: key }),
    });
}
export function useDecideAgent() {
    const cache = useQueryClient();
    return useMutation({
        mutationFn: (input: { id: string; decision: "applied" | "dismissed" }) =>
            client.agent.decide.mutate(input),
        retry: false,
        onSettled: async () => {
            await cache.invalidateQueries({ queryKey: key });
            await cache.invalidateQueries({ queryKey: ["feedback"] });
        },
    });
}
