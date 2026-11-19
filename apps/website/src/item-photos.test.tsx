import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CollectionEntry, ShoppingItem } from "@repo/client";
import {
    collectionPhoto,
    ItemPhoto,
    ItemPhotosProvider,
    ShoppingPhoto,
    shoppingPhoto,
} from "./item-photos";

const item = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Mueble para vinilos",
} as ShoppingItem;
const source = { title: "Fabricante", url: "https://example.com/product" };
const entry: CollectionEntry = {
    id: "furniture",
    title: "Mueble",
    kind: "reference",
    subtitle: "",
    body: "",
    category: "Hogar",
    label: "Referencia",
    image: "/media/furniture.webp",
    imageAlt: "Mueble de referencia",
    source,
    imageSource: source,
    shoppingItemId: item.id,
    layout: "square",
    tone: "paper",
    productSource: source,
    provenance: "home-reference",
    ownership: "reference",
    brand: "Ejemplo",
    model: "Modelo A",
    materials: ["Acero"],
    reason: null,
    rooms: ["Living"],
    shoppingRelation: "exact",
    images: [
        { path: "/media/furniture.webp", alt: "Mueble de referencia", source, role: "product" },
    ],
};
const useCollection = vi.hoisted(() => vi.fn());
vi.mock("./home.queries", () => ({ useCollection }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useCollection.mockReset().mockReturnValue({ data: { entries: [entry] } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

it("uses only exact references, never contextual objects, to illustrate a shopping need", () => {
    const turntable = {
        ...entry,
        id: "turntable",
        title: "Tocadiscos",
        shoppingRelation: "contextual" as const,
    };
    expect(shoppingPhoto(item, [turntable, entry]).src).toBe(entry.image);
    expect(shoppingPhoto(item, [turntable]).src).toBeNull();
    expect(shoppingPhoto({ ...item, id: "different" }, [entry]).src).toBeNull();
});
it("does not invent a model or an image when the explicit reference has no media", () => {
    expect(shoppingPhoto(item, [{ ...entry, images: [], image: null }]).src).toBeNull();
    expect(shoppingPhoto({ ...item, name: "Cafetera espresso" }, []).src).toBeNull();
    expect(collectionPhoto({ ...entry, kind: "note" }).src).toBeNull();
});
it("shares the imported selection across item thumbnails", async () => {
    await act(async () =>
        root.render(
            <ItemPhotosProvider>
                <ShoppingPhoto item={item} />
                <ShoppingPhoto item={item} />
            </ItemPhotosProvider>,
        ),
    );
    expect(useCollection).toHaveBeenCalledTimes(1);
    expect(
        [...container.querySelectorAll("img")].map((image) => image.getAttribute("src")),
    ).toEqual([entry.image, entry.image]);
});
it("does not substitute another model after an image error and preserves attribution", async () => {
    await act(async () => root.render(<ItemPhoto photo={collectionPhoto(entry)} detail />));
    expect(container.textContent).toContain("Imagen del modelo");
    expect(container.querySelector("a")?.href).toBe(source.url);
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Imagen no disponible");
    expect(container.querySelector("a")?.href).toBe(source.url);
});
it("labels manufacturer photos as references even when the record is owned", async () => {
    await act(async () =>
        root.render(
            <ItemPhoto
                photo={collectionPhoto({ ...entry, kind: "object", ownership: "owned" })}
                detail
            />,
        ),
    );
    expect(container.textContent).toContain("Imagen del modelo");
    expect(container.textContent).not.toContain("Foto del objeto");
});
it("can render a new source after an earlier image failed", async () => {
    await act(async () => root.render(<ItemPhoto photo={collectionPhoto(entry)} />));
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    await act(async () =>
        root.render(
            <ItemPhoto photo={{ ...collectionPhoto(entry), src: "/media/replacement.webp" }} />,
        ),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/replacement.webp");
});
