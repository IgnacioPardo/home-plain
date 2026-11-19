import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createHomeClient, type CreateFeedback, type FeedbackTarget } from "@repo/client";

const client = createHomeClient();
export function useFeedback(target: FeedbackTarget | null) {
    return useQuery({
        queryKey: ["feedback", target?.kind ?? "notes", target?.id ?? "all"],
        queryFn: ({ signal }) => client.feedback.list.query({ target }, { signal }),
        refetchInterval: (query) => (query.state.data?.state === "syncing" ? 2_000 : 60_000),
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: 1,
    });
}
export function useCreateFeedback() {
    const cache = useQueryClient();
    return useMutation({
        mutationFn: (input: CreateFeedback) => client.feedback.create.mutate(input),
        retry: false,
        onMutate: () => cache.cancelQueries({ queryKey: ["feedback"] }),
        onSuccess: async () => {
            await cache.cancelQueries({ queryKey: ["feedback"] });
            await cache.invalidateQueries({ queryKey: ["feedback"] });
        },
    });
}
