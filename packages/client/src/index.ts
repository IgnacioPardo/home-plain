export { createHomeClient, setHomeCsrfToken, onHomeUnauthorized } from "./client.ts";
export { readHomeSession, loginHome, logoutHome } from "./auth.ts";
export type { AuthSession } from "@repo/backend";
export type { ShoppingDashboard, ShoppingItem } from "@repo/backend";
export type { CollectionEntry, CollectionSnapshot, CollectionStatus } from "@repo/backend";
export type { MoodboardReference, MoodboardSnapshot } from "@repo/backend";

export type {
    FeedbackEntry,
    FeedbackTarget,
    FeedbackList,
    CreateFeedback,
    FeedbackCreateResult,
    ContentBlock,
    ContentText,
    ContentDocument,
    ContentIndex,
    ContentDocumentResult,
} from "@repo/backend";

export type { AgentRun, AgentProposal, StartAgent } from "@repo/backend";
