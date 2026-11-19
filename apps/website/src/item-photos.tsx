import { createContext, useContext, useState, type ReactNode } from "react";
import type { CollectionEntry, ShoppingItem } from "@repo/client";
import { useCollection } from "./home.queries";
import { catalogImages, type CatalogEntry, type CatalogImage } from "./catalog-model";
import "./item-photos.css";

type PhotoSource = { title: string; url: string };
export type ItemPhotoData = {
    src: string | null;
    alt: string;
    source: PhotoSource | null;
    role: CatalogImage["role"];
};
const CollectionPhotos = createContext<CollectionEntry[]>([]);

/** One shared query; individual thumbnails never start their own requests. */
export function ItemPhotosProvider({ children }: { children: ReactNode }) {
    const collection = useCollection();
    return <CollectionPhotos value={collection.data?.entries ?? []}>{children}</CollectionPhotos>;
}
export function imagePhoto(image: CatalogImage): ItemPhotoData {
    return { src: image.path, alt: image.alt, source: image.source, role: image.role };
}
export function collectionPhoto(entry: CatalogEntry): ItemPhotoData {
    const image = catalogImages(entry)[0];
    return image
        ? imagePhoto(image)
        : { src: null, alt: entry.title, source: null, role: "context" };
}
export function shoppingReference(item: ShoppingItem, entries: CatalogEntry[]) {
    return entries.find(
        (entry) =>
            entry.shoppingItemId === item.id &&
            entry.shoppingRelation === "exact" &&
            entry.kind !== "note",
    );
}
export function shoppingPhoto(item: ShoppingItem, entries: CatalogEntry[]): ItemPhotoData {
    const linked = shoppingReference(item, entries);
    return linked
        ? collectionPhoto(linked)
        : { src: null, alt: item.name, source: null, role: "product" };
}
export function ShoppingPhoto({ item, ...props }: { item: ShoppingItem } & PhotoOptions) {
    const entries = useContext(CollectionPhotos);
    return <ItemPhoto photo={shoppingPhoto(item, entries)} {...props} />;
}
export function ShoppingReferenceInfo({ item }: { item: ShoppingItem }) {
    const entries = useContext(CollectionPhotos);
    const reference = shoppingReference(item, entries);
    if (!reference) return null;
    return (
        <section className="shopping-reference-info">
            <h3>Modelo de referencia</h3>
            <p>
                <strong>
                    {[reference.brand, reference.model].filter(Boolean).join(" · ") ||
                        reference.title}
                </strong>
            </p>
            {reference.materials?.length ? <p>{reference.materials.join(" · ")}</p> : null}
            {reference.reason && <p>{reference.reason}</p>}
            {reference.productSource && (
                <a
                    href={reference.productSource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                >
                    {reference.productSource.title} ↗
                </a>
            )}
        </section>
    );
}

type PhotoOptions = { detail?: boolean; eager?: boolean; className?: string; decorative?: boolean };
export function ItemPhoto({
    photo,
    detail = false,
    eager = false,
    className = "",
    decorative = false,
}: { photo: ItemPhotoData } & PhotoOptions) {
    const [failedSources, setFailedSources] = useState<string[]>([]);
    const unavailable = !photo.src || failedSources.includes(photo.src);
    const credit =
        photo.role === "owned"
            ? "Imagen de Inventario"
            : photo.role === "product"
              ? "Imagen del modelo"
              : "Imagen de referencia";
    return (
        <span className={`item-photo ${detail ? "item-photo-detail" : ""} ${className}`}>
            <span className={`item-photo-stage ${unavailable ? "is-unavailable" : ""}`}>
                {unavailable ? (
                    <span
                        className="image-fallback"
                        role={decorative ? undefined : "img"}
                        aria-label={decorative ? undefined : `Imagen no disponible. ${photo.alt}`}
                    >
                        Imagen no disponible
                    </span>
                ) : (
                    <img
                        src={photo.src!}
                        alt={decorative ? "" : photo.alt}
                        width={600}
                        height={600}
                        loading={eager || detail ? "eager" : "lazy"}
                        decoding="async"
                        onError={() => setFailedSources((previous) => [...previous, photo.src!])}
                    />
                )}
            </span>
            {detail && photo.source && (
                <span className="item-photo-credit">
                    {credit} ·{" "}
                    <a href={photo.source.url} target="_blank" rel="noreferrer">
                        {photo.source.title}
                    </a>
                </span>
            )}
        </span>
    );
}
