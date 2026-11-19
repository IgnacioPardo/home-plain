import { setTimeout as delay } from "node:timers/promises";
import { InvalidAgentProposal, type AgentPlanner } from "./agent.schema.ts";
import type { AgentRunStore } from "./agent.store.ts";

export class PlannerError extends Error {
    constructor(readonly retryable: boolean) {
        super("Planning provider could not complete the request");
    }
}
export async function runAgentOnce(
    store: AgentRunStore,
    planner: AgentPlanner,
    stop = new AbortController().signal,
) {
    if (stop.aborted) return false;
    const claim = await store.claim();
    if (!claim) return false;
    const canceled = new AbortController();
    const timeout = AbortSignal.timeout(60_000);
    const signal = AbortSignal.any([stop, canceled.signal, timeout]);
    let heartbeat: Promise<void> | null = null;
    const timer = setInterval(() => {
        if (heartbeat) return;
        heartbeat = store
            .heartbeat(claim)
            .then((active) => {
                if (!active) canceled.abort();
            })
            .catch(() => canceled.abort())
            .finally(() => {
                heartbeat = null;
            });
    }, 10_000);
    timer.unref();
    try {
        let proposal: unknown;
        try {
            proposal = await planner.plan(claim.context, signal);
        } catch (error) {
            await store.fail(
                claim,
                stop.aborted ||
                    timeout.aborted ||
                    (error instanceof PlannerError && error.retryable),
            );
            return true;
        }
        if (signal.aborted) await store.fail(claim, stop.aborted || timeout.aborted);
        else {
            try {
                await store.complete(claim, proposal);
            } catch (error) {
                if (!(error instanceof InvalidAgentProposal)) throw error;
                await store.fail(claim, false);
            }
        }
    } finally {
        clearInterval(timer);
        if (heartbeat) await heartbeat;
    }
    return true;
}
export function startAgentWorker(store: AgentRunStore, planner: AgentPlanner) {
    const stop = new AbortController();
    const running = (async () => {
        while (!stop.signal.aborted) {
            let worked = false;
            try {
                worked = await runAgentOnce(store, planner, stop.signal);
            } catch {
                /* A database outage leaves the durable lease available for recovery. */
            }
            if (!worked) {
                try {
                    await delay(1000, undefined, { signal: stop.signal });
                } catch {
                    /* Shutdown interrupts the idle wait. */
                }
            }
        }
    })();
    return async () => {
        stop.abort();
        await running;
    };
}
