/** One instance per API process, shared by all Notion adapters. */
export class NotionRequestQueue {
    private pending: Promise<void> = Promise.resolve();
    private nextRequestAt = 0;
    constructor(
        private readonly request: typeof fetch = fetch,
        private readonly pause = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms)),
        private readonly now = () => Date.now(),
        private readonly intervalMs = 350,
    ) {}

    readonly fetch: typeof fetch = (input, init) => {
        const result = this.pending.then(async () => {
            const delay = this.nextRequestAt - this.now();
            if (delay > 0) await this.pause(delay);
            this.nextRequestAt = this.now() + this.intervalMs;
            const response = await this.request(input, init);
            const retryAfter = response.headers.get("retry-after");
            if (retryAfter !== null) {
                const seconds = Number(retryAfter);
                const until = Number.isFinite(seconds)
                    ? this.now() + Math.max(0, seconds * 1_000)
                    : Date.parse(retryAfter);
                if (Number.isFinite(until))
                    this.nextRequestAt = Math.max(this.nextRequestAt, until);
            }
            return response;
        });
        this.pending = result.then(
            () => {},
            () => {},
        );
        return result;
    };
}
