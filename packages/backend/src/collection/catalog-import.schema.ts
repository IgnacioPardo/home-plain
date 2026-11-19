import { z } from "zod";
import {
    catalogCategories,
    collectionMediaPathSchema,
    collectionSourceSchema,
} from "./collection.schema.ts";

export const gearOverrideSchema = z.object({
    id: z
        .string()
        .regex(/^[a-z0-9-]{1,60}$/)
        .optional(),
    ownership: z.enum(["owned", "reference"]).optional(),
    imageRole: z.enum(["owned", "product", "context"]).optional(),
    excludedImageSources: z
        .array(
            z
                .string()
                .url()
                .refine((value) => {
                    const url = new URL(value);
                    return (
                        ["https:", "http:"].includes(url.protocol) &&
                        !url.username &&
                        !url.password &&
                        !url.search &&
                        !url.hash
                    );
                }, "Image exclusion must be an origin and pathname without credentials, query or fragment")
                .transform(canonicalImageSource),
        )
        .optional(),
    brand: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    category: z.enum(catalogCategories).optional(),
    rooms: z.array(z.string()).optional(),
    reason: z.string().optional(),
    // An explicitly verified product page; saved Inventario Website fields may refer to another variant.
    productSource: collectionSourceSchema.nullable().optional(),
});
export const catalogImportConfigSchema = z.object({
    gearDataSourceId: z.string().uuid(),
    productReferencesDataSourceId: z.string().uuid(),
    shoppingDataSourceId: z.string().uuid(),
    snapshotPath: z.string().min(1),
    mediaDirectory: z.string().min(1),
    reviewPath: z.string().min(1),
    legacySnapshotPath: z.string().min(1).optional(),
    imageHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1),
    approvedGearMedia: z.array(collectionMediaPathSchema).default([]),
    // Inventory membership does not mean an object belongs in the Home project.
    includedGearPageIds: z.array(z.string().uuid()).default([]),
    gearOverrides: z.record(z.string().uuid(), gearOverrideSchema).default({}),
});
export type CatalogImportConfig = z.infer<typeof catalogImportConfigSchema>;
export type GearOverride = z.infer<typeof gearOverrideSchema>;

export function canonicalImageSource(value: string): string {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
}
