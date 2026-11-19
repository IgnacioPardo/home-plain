import type { CollectionEntry } from "@repo/client";

export type CatalogEntry = CollectionEntry;
export type CatalogImage = CollectionEntry["images"][number];
export const catalogCategories = [
    "Hogar",
    "Trabajo",
    "Audio y música",
    "Tecnología",
    "Fotografía",
    "Ropa y calzado",
    "Accesorios personales",
    "Deporte y movilidad",
    "Otros",
];
export function categoryOrder(a: string, b: string) {
    const rank = (value: string) => {
        const index = catalogCategories.indexOf(value);
        return index < 0 ? catalogCategories.length : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b, "es");
}
export function catalogText(entry: CatalogEntry) {
    return [
        entry.title,
        entry.subtitle,
        entry.body,
        entry.category,
        entry.brand,
        entry.model,
        entry.reason,
        ...(entry.materials ?? []),
        ...(entry.rooms ?? []),
    ]
        .filter(Boolean)
        .join(" ");
}
/** Keep source wording, but do not repeat the same product identity on separate lines. */
export function catalogIdentity(entry: CatalogEntry) {
    const heading = entry.model?.trim() || entry.title;
    if (entry.kind === "note") {
        return {
            heading,
            brand: entry.brand,
            title: entry.model && entry.title !== entry.model ? entry.title : null,
            subtitle: entry.subtitle !== entry.title ? entry.subtitle : null,
        };
    }
    const words = (value: string) =>
        value
            .normalize("NFC")
            .toLowerCase()
            // Normalize word separators, preserving model symbols and numeric punctuation.
            .replace(/(?<=\p{L})[.\-·•—–](?=\p{L})/gu, " ")
            .replace(/(?<=\p{L})\s+[.\-·•—–]\s+(?=\p{L})/gu, " ")
            .replace(/\s+/gu, " ")
            .trim();
    const brand = entry.brand?.trim() || null;
    const headingWords = words(heading);
    const brandWords = words(brand ?? "");
    const headingIncludesBrand =
        !!brandWords && (headingWords === brandWords || headingWords.startsWith(`${brandWords} `));
    const seen = new Set(
        [
            "",
            brand ?? "",
            heading,
            `${brand ?? ""} ${heading}`,
            ...(headingIncludesBrand ? [headingWords.slice(brandWords.length)] : []),
        ].map(words),
    );
    const distinct = (value: string) => {
        const identity = words(value);
        if (seen.has(identity)) return null;
        seen.add(identity);
        return value;
    };
    return {
        heading,
        brand: headingIncludesBrand ? null : brand,
        title: distinct(entry.title),
        subtitle: distinct(entry.subtitle),
    };
}
export function provenanceLabel(entry: CatalogEntry) {
    if (entry.provenance === "my-gear") {
        return entry.ownership === "reference" ? "Inventario · Referencia" : "Inventario";
    }
    if (entry.provenance === "home-reference") return "Para la casa";
    return entry.label || "Referencia";
}
export function catalogImages(entry: CatalogEntry): CatalogImage[] {
    if (entry.kind === "note") return [];
    if (entry.images?.length) return entry.images;
    return entry.image
        ? [
              {
                  path: entry.image,
                  alt: entry.imageAlt || entry.title,
                  source: entry.imageSource ?? entry.source,
                  role: "context",
              },
          ]
        : [];
}
