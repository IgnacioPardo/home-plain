import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    feedbackDraftKey,
    readFeedbackDraft,
    storeFeedbackDraft,
    type FeedbackDraft,
} from "./feedback.drafts";

const account = { username: "home", role: "commenter" as const };
const target = { kind: "shopping" as const, id: "00000000-0000-4000-8000-000000000001" };
const key = feedbackDraftKey(account, target);
function pending(): FeedbackDraft {
    return {
        title: "",
        body: "Medir antes de comprar.",
        displayAuthor: "Persona A",
        submission: {
            operationId: "00000000-0000-4000-8000-000000000002",
            kind: "comment",
            title: "",
            body: "Medir antes de comprar.",
            displayAuthor: "Persona A",
            target,
        },
    };
}
beforeEach(() => sessionStorage.clear());
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
it.each([
    ["body mismatch", () => ({ ...pending(), body: "Otro cuerpo" })],
    ["author mismatch", () => ({ ...pending(), displayAuthor: "Persona B" })],
    ["oversized body", () => ({ ...pending(), body: "x".repeat(8001) })],
    [
        "missing operation",
        () => ({ ...pending(), submission: { ...pending().submission, operationId: undefined } }),
    ],
    ["unknown field", () => ({ ...pending(), role: "owner" })],
    [
        "target mismatch",
        () => ({
            ...pending(),
            submission: { ...pending().submission, target: { ...target, id: "another-target" } },
        }),
    ],
])("rejects %s without discarding the stored recovery record", (_reason, value) => {
    const raw = JSON.stringify(value());
    sessionStorage.setItem(key, raw);
    expect(readFeedbackDraft(key, target).error).toBe(true);
    expect(sessionStorage.getItem(key)).toBe(raw);
});
it("does not treat malformed JSON or unavailable storage as a fresh empty draft", () => {
    sessionStorage.setItem(key, "{unfinished");
    expect(readFeedbackDraft(key, target).error).toBe(true);
    vi.stubGlobal("sessionStorage", {
        getItem: () => {
            throw new DOMException("Denied", "SecurityError");
        },
    });
    expect(readFeedbackDraft(key, target).error).toBe(true);
});
it("persists the exact pending payload and isolates keys by authenticated account and target", () => {
    expect(storeFeedbackDraft(key, pending())).toBe(true);
    expect(readFeedbackDraft(key, target)).toEqual({
        draft: pending(),
        recovered: true,
        error: false,
    });
    const other = feedbackDraftKey({ username: "owner", role: "owner" }, target);
    expect(readFeedbackDraft(other, target).recovered).toBe(false);
    expect(feedbackDraftKey(account, null)).not.toBe(key);
});
