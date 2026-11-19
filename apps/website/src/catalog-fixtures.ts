import type { CollectionEntry } from "@repo/client";

/** Synthetic stories and tests only; never an import or an inventory fallback. */
export function catalogFixture(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
    return {
        id: "fixture-lamp",
        kind: "reference",
        title: "Lámpara de mesa",
        subtitle: "",
        body: "",
        category: "Hogar",
        label: "Referencia",
        image: "/media/fixture-lamp.webp",
        imageAlt: "Lámpara de prueba",
        productSource: null,
        source: { title: "Ficha de prueba", url: "https://example.com/notion" },
        imageSource: { title: "Imagen de prueba", url: "https://example.com/lamp" },
        shoppingItemId: null,
        layout: "square",
        tone: "paper",
        provenance: "home-reference",
        ownership: "reference",
        brand: "Estudio de prueba",
        model: "Modelo A",
        materials: ["Acero", "Difusor de vidrio"],
        reason: "Luz puntual para lectura.",
        rooms: ["Living"],
        shoppingRelation: null,
        images: [
            {
                path: "/media/fixture-lamp.webp",
                alt: "Lámpara de prueba",
                source: { title: "Imagen de prueba", url: "https://example.com/lamp" },
                role: "product",
            },
        ],
        ...overrides,
    };
}
