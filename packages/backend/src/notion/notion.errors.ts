export class NotionReadError extends Error {
    constructor(
        readonly reason: "http" | "network" | "schema" | "pagination",
        readonly status?: number,
        cause?: unknown,
    ) {
        super(`Notion read failed (${reason})`, { cause });
        this.name = "NotionReadError";
    }
}
