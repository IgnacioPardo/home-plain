import { z } from "zod";
import type { AuthSession, CreateFeedback, FeedbackTarget } from "@repo/client";

const prefix = "home:feedback-draft:v1:";
const targetSchema = z
    .object({
        kind: z.enum(["document", "shopping", "collection", "moodboard", "note"]),
        id: z
            .string()
            .min(1)
            .max(100)
            .regex(/^[a-zA-Z0-9-]+$/),
    })
    .strict();
const submissionSchema: z.ZodType<CreateFeedback> = z
    .object({
        operationId: z.string().uuid(),
        kind: z.enum(["comment", "note"]),
        displayAuthor: z.enum(["Persona A", "Persona B"]),
        title: z.string().max(160),
        body: z.string().min(1).max(8000),
        target: targetSchema.nullable(),
    })
    .strict()
    .refine((value) =>
        value.kind === "comment"
            ? value.target !== null
            : value.target === null && Boolean(value.title),
    );
const draftSchema = z
    .object({
        title: z.string().max(160),
        body: z.string().max(8000),
        displayAuthor: z.enum(["Persona A", "Persona B"]),
        submission: submissionSchema.nullable(),
    })
    .strict()
    .refine(
        (draft) =>
            !draft.submission ||
            (draft.submission.body === draft.body.trim() &&
                draft.submission.title ===
                    (draft.submission.kind === "comment" ? "" : draft.title.trim()) &&
                draft.submission.displayAuthor === draft.displayAuthor),
    );
export type FeedbackDraft = z.infer<typeof draftSchema>;
export const emptyFeedbackDraft = (): FeedbackDraft => ({
    title: "",
    body: "",
    displayAuthor: "Persona A",
    submission: null,
});
export type DraftAccount = Pick<AuthSession, "username" | "role">;
export function feedbackDraftKey(account: DraftAccount, target: FeedbackTarget | null) {
    return `${prefix}${encodeURIComponent(account.username)}:${account.role}:${target ? `${target.kind}:${target.id}` : "new-note"}`;
}
export function readFeedbackDraft(key: string, target: FeedbackTarget | null) {
    try {
        const raw = sessionStorage.getItem(key);
        const draft = raw ? draftSchema.parse(JSON.parse(raw)) : emptyFeedbackDraft();
        if (
            draft.submission &&
            (draft.submission.target?.kind !== target?.kind ||
                draft.submission.target?.id !== target?.id)
        )
            throw new Error("Stored draft target changed");
        return { draft, recovered: Boolean(raw), error: false };
    } catch {
        return { draft: emptyFeedbackDraft(), recovered: false, error: true };
    }
}
export function storeFeedbackDraft(key: string, draft: FeedbackDraft): boolean {
    try {
        const value = draftSchema.parse(draft);
        if (!value.title && !value.body && !value.submission) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}
let generation = 0;
export const feedbackDraftGeneration = () => generation;
export function feedbackSessionReason(event: Event): string | undefined {
    return event instanceof CustomEvent ? event.detail?.reason : undefined;
}
if (typeof window !== "undefined")
    window.addEventListener("home:session-cleared", (event) => {
        generation++;
        const reason = feedbackSessionReason(event);
        if (reason === "expired" || reason === "refreshed") return;
        try {
            for (const key of Object.keys(sessionStorage))
                if (key.startsWith(prefix)) sessionStorage.removeItem(key);
        } catch {
            // Storage denial also makes recovery and submit fail closed.
        }
    });
