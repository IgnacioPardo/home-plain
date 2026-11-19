export class FeedbackError extends Error {
    constructor(
        readonly reason:
            | "unconfigured"
            | "invalid_target"
            | "operation_conflict"
            | "journal_unavailable"
            | "schema"
            | "rejected"
            | "unavailable"
            | "uncertain",
    ) {
        super(`Feedback ${reason}`);
        this.name = "FeedbackError";
    }
}
