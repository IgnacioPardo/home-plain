import { z } from "zod";

export const shoppingItemSchema = z.object({
    id: z.string().uuid(),
    url: z.string().url(),
    name: z.string().min(1),
    room: z.string(),
    priority: z.string(),
    status: z.string(),
    origin: z.string(),
    initialQuantity: z.string(),
    targetQuantity: z.string(),
    quality: z.string(),
    condition: z.string(),
    notes: z.string(),
    estimatedPriceArs: z.number().nonnegative().nullable(),
    reference: z.string().url().nullable(),
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;

export const snapshotSchema = z.object({
    version: z.literal(1),
    dataSourceId: z.string().uuid(),
    syncedAt: z.string().datetime(),
    source: z.enum(["api", "import"]),
    items: z.array(shoppingItemSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const shoppingDashboardSchema = z.object({
    state: z.enum(["unconfigured", "live", "stale", "offline", "syncing", "error"]),
    configured: z.boolean(),
    snapshot: snapshotSchema.nullable(),
    issue: z.enum(["not_configured", "upstream_unavailable", "cache_unavailable"]).nullable(),
});
export type ShoppingDashboard = z.infer<typeof shoppingDashboardSchema>;

export const setPurchasedSchema = z.strictObject({
    id: z
        .string()
        .uuid()
        .transform((id) => id.toLowerCase()),
    purchased: z.boolean(),
    expectedStatus: z.string().max(200),
});
export type SetPurchased = z.infer<typeof setPurchasedSchema>;
