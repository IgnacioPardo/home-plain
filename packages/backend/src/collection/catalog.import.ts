import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
    collectionSnapshotSchema,
    type CollectionEntry,
    type CollectionSnapshot,
} from "./collection.schema.ts";
import {
    catalogImportConfigSchema,
    canonicalImageSource,
    type CatalogImportConfig,
    type GearOverride,
} from "./catalog-import.schema.ts";
import { CatalogNotionReader, type GearRecord } from "./catalog-notion.reader.ts";
import { cacheCatalogImage } from "./catalog-media.ts";

const notionSource = (id: string, title: string) => ({
    title,
    url: `https://app.notion.com/p/${id.replaceAll("-", "")}`,
});
const categoryTags: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["Fotografía", ["photography", "fotografia", "camera"]],
    ["Audio y música", ["music", "musica", "audio", "guitar", "guitarra"]],
    [
        "Hogar",
        ["mug", "taza", "decoration", "decoracion", "model car", "playing cards", "hogar", "home"],
    ],
    ["Trabajo", ["desk", "escritorio", "office", "oficina", "trabajo"]],
    ["Ropa y calzado", ["clothes", "clothing", "ropa", "shoes", "footwear", "calzado"]],
    ["Deporte y movilidad", ["sport", "sports", "deporte", "car", "bike", "running", "movilidad"]],
    ["Accesorios personales", ["watch", "reloj", "perfume", "fragrance"]],
];
function normalizeCategoryText(value: string): string {
    return value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}
export function classifyGear(title: string, tags: string[]): string {
    const normalized = new Set(tags.map(normalizeCategoryText));
    // Domain tags outrank brand names and broad tags such as Accessory or Tech.
    for (const [category, values] of categoryTags)
        if (values.some((value) => normalized.has(value))) return category;
    const specific = classifyGearTitle(normalizeCategoryText(title));
    if (specific) return specific;
    if (["accessory", "accessories", "accesorio", "accesorios"].some((tag) => normalized.has(tag)))
        return "Accesorios personales";
    if (["tech", "technology", "tecnologia", "electronics"].some((tag) => normalized.has(tag)))
        return "Tecnología";
    return "Otros";
}
function classifyGearTitle(words: string): string | null {
    if (
        /camera|fotogra|\blens\b|tripod|\bnikon\b|\bcanon\b|fujifilm|pentax|mavica|instax|\bsony a\d/.test(
            words,
        )
    )
        return "Fotografía";
    if (
        /guitar|guitarra|\bbass\b|\bbajo\b|epiphone|\bcort\b|scarlett|focusrite|audinac|turntable|tocadiscos|audio-technica|at-lp\d|homepod|\bjbl\b|speaker|parlante|ampli|headphone|auricular|earphone|airpods|\bsound\b|microphone|microfono|samson r21|ue\s?4000/.test(
            words,
        )
    )
        return "Audio y música";
    if (
        /\bmug\b|taza|cafe|coffee|delonghi|longhi|kitchen|cocina|lamp|lampara|silla|chair|mesa|table\b|sofa|mueble|furniture|hogar|house|home|vajilla|\bplate|\bbowl|kettle|hervidor|botella|bottle|playing cards|\bnaipes\b|\bbaraja\b|model car/.test(
            words,
        )
    )
        return "Hogar";
    if (
        /keyboard|teclado|mouse|trackpad|monitor|\bdesk\b|escritorio|office|oficina|work|trabajo|moleskine|notebook|\bpen\b|lapicera|mx keys|mx master|power strip|regleta|calculator|calculadora|\bfx-?\d/.test(
            words,
        )
    )
        return "Trabajo";
    if (
        /pajama|pijama|remera|camisa|shirt|jersey|hoodie|buzo|sweater|jacket|campera|pantalon|jeans|shorts|shoe|zapatilla|sneaker|\bboot|sandal|calzado|bayern|\bropa\b|clothing|footwear/.test(
            words,
        )
    )
        return "Ropa y calzado";
    if (
        /boxing|boxeo|\bwrap|guante|bicycle|bicicleta|\be-bike\b|\bbike\b|patin|\bsport|deporte|pelota|ball\b|racket|raqueta|gamecourt|everlast|running|fitness|gym/.test(
            words,
        )
    )
        return "Deporte y movilidad";
    // A tracker or USB peripheral remains technology even when tagged Accessory.
    if (/tracker|airtag|charger|cargador|usb|\bssd\b|hard drive|cable/.test(words))
        return "Tecnología";
    if (
        /\bwatch|reloj|seiko|g-shock|casio f-?\d|invicta|wallet|billetera|sunglass|anteojo|glasses|mochila|backpack|bag\b|bolso|perfume|cinturon/.test(
            words,
        )
    )
        return "Accesorios personales";
    if (
        /apple|iphone|ipad|macbook|mac mini|\bpc\b|\bcomputer|computadora|samsung|kindle|nintendo|playstation|xbox|\bps[1-5]\b|\bswitch\b|anker|\btv\b|televis|tablet|smartphone|telefono|electronics|tecnolog/.test(
            words,
        )
    )
        return "Tecnología";
    return null;
}
const brands = [
    "Audio-Technica",
    "Apple",
    "Logitech",
    "Sony",
    "Samsung",
    "Epiphone",
    "Focusrite",
    "Cort",
    "Texas",
    "Audinac",
    "JBL",
    "Anker",
    "Moleskine",
    "Nike",
    "Adidas",
    "New Balance",
    "Puma",
    "Vans",
    "Converse",
    "Uniqlo",
    "Zara",
    "Seiko",
    "Casio",
    "Everlast",
    "Nintendo",
    "Canon",
    "Nikon",
    "Fujifilm",
];
function gearBrand(record: GearRecord): string | null {
    return (
        brands.find(
            (brand) =>
                record.tags.some((tag) => tag.toLowerCase() === brand.toLowerCase()) ||
                record.title.toLowerCase().startsWith(`${brand.toLowerCase()} `),
        ) ?? null
    );
}
function pageIdInUrl(value: string): string | null {
    const url = new URL(value);
    if (!["app.notion.com", "www.notion.so", "notion.so"].includes(url.hostname)) return null;
    return (
        url.pathname
            .replaceAll("-", "")
            .match(/([a-f0-9]{32})\/?$/i)?.[1]
            ?.toLowerCase() ?? null
    );
}
async function previousSnapshot(config: CatalogImportConfig): Promise<CollectionSnapshot | null> {
    if (!config.legacySnapshotPath) return null;
    return collectionSnapshotSchema.parse(
        JSON.parse(await readFile(config.legacySnapshotPath, "utf8")),
    );
}

export async function prepareCatalogGear(options: {
    config: CatalogImportConfig;
    reader: CatalogNotionReader;
    request?: typeof fetch;
    now?: Date;
    preparedGear?: GearRecord[];
}): Promise<CollectionSnapshot> {
    const config = catalogImportConfigSchema.parse(options.config),
        previous = await previousSnapshot(config);
    const entries: CollectionEntry[] = [];
    const records = options.preparedGear ?? (await options.reader.gear(config.gearDataSourceId));
    if (!options.preparedGear)
        await atomicCatalogJson(`${config.reviewPath}.sources.json`, {
            version: 1,
            dataSourceId: config.gearDataSourceId,
            capturedAt: (options.now ?? new Date()).toISOString(),
            records,
        });
    const included = new Set(config.includedGearPageIds.map((id) => id.toLowerCase()));
    const selectedRecords = records
        .filter((record) => included.has(record.pageId.toLowerCase()))
        .map((record) => {
            const excluded = new Set(
                config.gearOverrides[record.pageId]?.excludedImageSources ?? [],
            );
            return {
                ...record,
                images: record.images.filter((image) => !excluded.has(canonicalImageSource(image))),
            };
        });
    preflightHosts(
        selectedRecords.flatMap((record) => record.images),
        config.imageHosts,
    );
    for (const record of selectedRecords) {
        const override: GearOverride = config.gearOverrides[record.pageId] ?? {};
        const old = previous?.entries.find(
            (entry) => pageIdInUrl(entry.source.url) === record.pageId.replaceAll("-", ""),
        );
        const source = notionSource(record.pageId, `${record.title} · Inventario`);
        const ownership = override.ownership ?? "owned";
        const images: CollectionEntry["images"] = [];
        for (const url of record.images) {
            const path = await cacheCatalogImage(
                url,
                config.mediaDirectory,
                config.imageHosts,
                options.request,
            ).catch((error: unknown) => {
                throw new Error(
                    `Image import failed for page ${record.pageId}: ${error instanceof Error ? error.message : "unavailable image"}`,
                );
            });
            if (!images.some((image) => image.path === path))
                images.push({
                    path,
                    alt: record.title,
                    source,
                    role: override.imageRole ?? "context",
                });
        }
        const brand = override.brand !== undefined ? override.brand : gearBrand(record);
        entries.push({
            id: override.id ?? old?.id ?? `gear-${record.pageId.replaceAll("-", "")}`,
            kind: ownership === "owned" ? "object" : "reference",
            title: record.title,
            subtitle: brand ?? "Inventario",
            body: "",
            category: override.category ?? classifyGear(record.title, record.tags),
            label: ownership === "owned" ? "En Inventario" : "Referencia",
            image: images[0]?.path ?? null,
            imageAlt: record.title,
            source,
            imageSource: images[0]?.source ?? null,
            shoppingItemId: old?.shoppingItemId ?? null,
            shoppingRelation: old?.shoppingItemId ? "contextual" : null,
            layout: "square",
            tone: "paper",
            provenance: "my-gear",
            ownership,
            productSource: override.productSource ?? null,
            brand,
            model: override.model ?? null,
            materials: [],
            reason: override.reason ?? null,
            rooms: override.rooms ?? [],
            images,
        });
    }
    const snapshot = collectionSnapshotSchema.parse({
        version: 2,
        source: "import",
        importedAt: (options.now ?? new Date()).toISOString(),
        entries,
    });
    await atomicCatalogJson(config.reviewPath, snapshot);
    return snapshot;
}

export async function importCatalog(options: {
    config: CatalogImportConfig;
    reader: CatalogNotionReader;
    request?: typeof fetch;
    now?: Date;
}): Promise<CollectionSnapshot> {
    const config = catalogImportConfigSchema.parse(options.config),
        previous = await previousSnapshot(config);
    // Complete and validate all sources before installing any snapshot.
    const gear = await prepareCatalogGear(options);
    const products = await options.reader.products(config.productReferencesDataSourceId);
    preflightHosts(
        products.flatMap((product) => product.images),
        config.imageHosts,
    );
    const shopping = await options.reader.pages(config.shoppingDataSourceId);
    const expected = new Set(shopping.map((page) => page.id));
    const selected = new Set(products.map((product) => product.shoppingItemId));
    if (
        selected.size !== products.length ||
        selected.size !== expected.size ||
        [...selected].some((id) => !expected.has(id))
    )
        throw new Error("Product references must cover every shopping need exactly once");
    const approved = new Set(config.approvedGearMedia);
    const entries: CollectionEntry[] = gear.entries.map((entry) => {
        const images = entry.images.filter((image) => approved.has(image.path));
        return {
            ...entry,
            images,
            image: images[0]?.path ?? null,
            imageSource: images[0]?.source ?? null,
        };
    });
    const assignedIds = new Set(entries.map((entry) => entry.id));
    for (const product of products) {
        const candidates =
            previous?.entries.filter(
                (entry) => entry.kind === "reference" && !assignedIds.has(entry.id),
            ) ?? [];
        const old =
            candidates.find(
                (entry) =>
                    entry.provenance === "home-reference" &&
                    pageIdInUrl(entry.source.url) === product.pageId.replaceAll("-", ""),
            ) ??
            candidates.find(
                (entry) =>
                    entry.provenance === "legacy" &&
                    entry.shoppingItemId === product.shoppingItemId &&
                    pageIdInUrl(entry.source.url) === product.shoppingItemId.replaceAll("-", ""),
            );
        const entryId = old?.id ?? `reference-${product.pageId.replaceAll("-", "")}`;
        if (assignedIds.has(entryId))
            throw new Error("Catalog reference identity conflicts with another record");
        assignedIds.add(entryId);
        const images: CollectionEntry["images"] = [];
        for (const url of product.images) {
            const path = await cacheCatalogImage(
                url,
                config.mediaDirectory,
                config.imageHosts,
                options.request,
            ).catch((error: unknown) => {
                throw new Error(
                    `Image import failed for reference ${product.pageId}: ${error instanceof Error ? error.message : "unavailable image"}`,
                );
            });
            if (!images.some((image) => image.path === path))
                images.push({
                    path,
                    alt: `${product.brand} ${product.model}`,
                    source: product.imageSource,
                    role: "product",
                });
        }
        entries.push({
            id: entryId,
            kind: "reference",
            title: product.title,
            subtitle: `${product.brand} · ${product.model}`,
            body: "",
            category: product.category,
            label: "Referencia para la casa",
            image: images[0]?.path ?? null,
            imageAlt: `${product.brand} ${product.model}`,
            source: notionSource(product.pageId, "Referencias de productos"),
            imageSource: images[0]?.source ?? null,
            productSource: product.source,
            shoppingItemId: product.shoppingItemId,
            shoppingRelation: "exact",
            layout: "square",
            tone: "paper",
            provenance: "home-reference",
            ownership: "reference",
            brand: product.brand,
            model: product.model,
            materials: product.materials,
            reason: product.reason,
            rooms: product.rooms,
            images,
        });
    }
    // Preserve notes; unselected, sold or removed inventory records must not return on reimport.
    entries.push(...(previous?.entries.filter((entry) => entry.kind === "note") ?? []));
    const snapshot = collectionSnapshotSchema.parse({
        version: 2,
        source: "import",
        importedAt: (options.now ?? new Date()).toISOString(),
        entries,
    });
    await atomicCatalogJson(config.snapshotPath, snapshot);
    return snapshot;
}
export async function atomicCatalogJson(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

function preflightHosts(urls: string[], allowed: string[]): void {
    const missing = [
        ...new Set(
            urls.map((url) => new URL(url).hostname).filter((host) => !allowed.includes(host)),
        ),
    ].sort();
    if (missing.length)
        throw new Error(`Image hosts missing from allowlist: ${missing.join(", ")}`);
}
