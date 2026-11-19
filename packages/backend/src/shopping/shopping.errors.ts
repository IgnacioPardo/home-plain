import type { ShoppingItem } from "./shopping.schema.ts";

export class ShoppingWriteError extends Error {
    constructor(
        readonly reason:
            | "schema"
            | "unconfigured"
            | "not_found"
            | "conflict"
            | "forbidden"
            | "unavailable"
            | "uncertain",
        readonly currentItem?: ShoppingItem,
    ) {
        super(`Shopping update failed (${reason})`);
        this.name = "ShoppingWriteError";
    }
}
