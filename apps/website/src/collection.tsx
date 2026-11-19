import { ShoppingPhoto, ItemPhoto, collectionPhoto, imagePhoto } from "./item-photos";
import { useContextLink } from "./context-link";
import { FeedbackPanel } from "./feedback";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Search } from "lucide-react";
import type { ShoppingItem } from "@repo/client";
import { useCollection, useCollectionStatus, useDashboard } from "./home.queries";
import {
    Badge,
    DetailSection,
    EmptyState,
    ExternalLink,
    Heading,
    Modal,
    normalize,
    ShoppingDetail,
} from "./ui";
import {
    catalogImages,
    catalogIdentity,
    catalogText,
    categoryOrder,
    provenanceLabel,
    type CatalogEntry,
} from "./catalog-model";
import "./catalog.css";

type Provenance = "all" | "my-gear" | "home-reference";
export type CatalogFilters = {
    query: string;
    category: string;
    brand: string;
    provenance: Provenance;
};
const emptyFilters: CatalogFilters = { query: "", category: "", brand: "", provenance: "all" };
export function filterCatalog(entries: CatalogEntry[], filters: CatalogFilters) {
    return entries.filter(
        (entry) =>
            entry.kind !== "note" &&
            (!filters.category || entry.category === filters.category) &&
            (!filters.brand || entry.brand === filters.brand) &&
            (filters.provenance === "all" || entry.provenance === filters.provenance) &&
            normalize(catalogText(entry)).includes(normalize(filters.query)),
    );
}

export function CollectionPage() {
    const collection = useCollection();
    const status = useCollectionStatus();
    const shopping = useDashboard();
    const [filters, setFilters] = useState(emptyFilters);
    const [selected, setSelected] = useState<CatalogEntry | null>(null);
    const [selectedItem, setSelectedItem] = useState<ShoppingItem | null>(null);
    const entries = collection.data?.entries ?? [];
    const objects = entries.filter((entry) => entry.kind !== "note");
    const items = shopping.data?.snapshot?.items ?? [];
    useContextLink("objeto", entries, setSelected);
    // Existing shared links pointed shopping fragments at /. Keep them resolvable.
    useContextLink("compra", items, setSelectedItem);
    const visible = filterCatalog(objects, filters);
    const categories = [...new Set(objects.map((entry) => entry.category))].sort(categoryOrder);
    const brands = [
        ...new Set(objects.flatMap((entry: CatalogEntry) => (entry.brand ? [entry.brand] : []))),
    ].sort((a, b) => a.localeCompare(b, "es"));
    const change = (value: Partial<CatalogFilters>) =>
        setFilters((current) => ({ ...current, ...value }));
    const groups = [...new Set(visible.map((entry) => entry.category))].sort(categoryOrder);
    const currentSelection = selected ? entries.find((entry) => entry.id === selected.id) : null;
    return (
        <>
            <Heading
                title="Catálogo"
                action={
                    <Link to="/lista" className="text-link">
                        Lista de compras <ArrowUpRight size={15} />
                    </Link>
                }
            />
            {objects.length > 0 && (
                <>
                    <div className="catalog-toolbar">
                        <div className="filter-tabs" role="group" aria-label="Procedencia">
                            {(
                                [
                                    ["all", "Todo"],
                                    ["my-gear", "Inventario"],
                                    ["home-reference", "Para la casa"],
                                ] as const
                            ).map(([value, label]) => (
                                <button
                                    key={value}
                                    onClick={() => change({ provenance: value })}
                                    aria-pressed={filters.provenance === value}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <label className="catalog-search">
                            <Search size={17} aria-hidden="true" />
                            <input
                                type="search"
                                aria-label="Buscar en el catálogo"
                                value={filters.query}
                                onChange={(e) => change({ query: e.target.value })}
                                placeholder="Buscar objetos, marcas, materiales…"
                            />
                        </label>
                    </div>
                    <div className="catalog-selectors">
                        <label>
                            Categoría
                            <select
                                value={filters.category}
                                onChange={(e) => change({ category: e.target.value })}
                            >
                                <option value="">Todas</option>
                                {categories.map((category) => (
                                    <option key={category}>{category}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Marca
                            <select
                                value={filters.brand}
                                onChange={(e) => change({ brand: e.target.value })}
                            >
                                <option value="">Todas</option>
                                {brands.map((brand) => (
                                    <option key={brand}>{brand}</option>
                                ))}
                            </select>
                        </label>
                        <span className="catalog-count" role="status">
                            {visible.length} {visible.length === 1 ? "objeto" : "objetos"}
                        </span>
                        {(filters.query ||
                            filters.category ||
                            filters.brand ||
                            filters.provenance !== "all") && (
                            <button
                                className="text-button"
                                onClick={() => setFilters(emptyFilters)}
                            >
                                Limpiar filtros
                            </button>
                        )}
                    </div>
                </>
            )}
            {collection.isPending ? (
                <div className="collection-skeleton" aria-label="Cargando catálogo" role="status">
                    <div />
                    <div />
                    <div />
                </div>
            ) : objects.length ? (
                <>
                    {groups.map((category) => (
                        <section className="catalog-section" key={category} aria-label={category}>
                            <div className="catalog-section-heading">
                                <h2>{category}</h2>
                                <span>
                                    {visible.filter((entry) => entry.category === category).length}
                                </span>
                            </div>
                            <div className="catalog-grid">
                                {visible
                                    .filter((entry) => entry.category === category)
                                    .map((entry) => (
                                        <CollectionCard
                                            key={entry.id}
                                            entry={entry}
                                            onOpen={() => setSelected(entry)}
                                        />
                                    ))}
                            </div>
                        </section>
                    ))}
                    {!visible.length && (
                        <EmptyState title="No hay objetos con esos filtros.">
                            <button
                                className="text-button"
                                onClick={() => setFilters(emptyFilters)}
                            >
                                Limpiar filtros
                            </button>
                        </EmptyState>
                    )}
                </>
            ) : (
                <ShoppingCollection
                    items={items}
                    pending={shopping.isPending}
                    failed={shopping.isError}
                    onOpen={setSelectedItem}
                />
            )}
            {(collection.isError || status.isError) && (
                <p className="inline-notice" role="status">
                    No se pudo actualizar el catálogo.{" "}
                    <button
                        className="text-button"
                        disabled={collection.isFetching}
                        onClick={() => {
                            void collection.refetch();
                            void status.refetch();
                        }}
                    >
                        Volver a intentar
                    </button>
                </p>
            )}
            {status.data?.state === "stale" && (
                <p className="inline-notice" role="status">
                    La última importación no se pudo leer. Se conserva el catálogo anterior.
                </p>
            )}
            {collection.data && (
                <p className="catalog-import">
                    Catálogo importado el{" "}
                    {new Date(collection.data.importedAt).toLocaleString("es-AR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                    })}
                    . La lista de compras se sincroniza por separado.
                </p>
            )}
            {currentSelection && (
                <CollectionDetail entry={currentSelection} onClose={() => setSelected(null)} />
            )}
            {selectedItem && (
                <ShoppingDetail item={selectedItem} onClose={() => setSelectedItem(null)} />
            )}
        </>
    );
}
export function CollectionCard({ entry, onOpen }: { entry: CatalogEntry; onOpen: () => void }) {
    const identity = catalogIdentity(entry);
    if (entry.kind === "note")
        return (
            <button
                id={`objeto-${entry.id}`}
                className="catalog-note"
                onClick={onOpen}
                aria-label={`Ver ${entry.title}`}
            >
                <span>{entry.category}</span>
                <h2>{entry.title}</h2>
                <p>{entry.body}</p>
                <span className="text-link">
                    Leer nota <ArrowUpRight size={14} />
                </span>
            </button>
        );
    return (
        <button
            id={`objeto-${entry.id}`}
            className="catalog-card"
            onClick={onOpen}
            aria-label={`Ver ${entry.title.replace(/\n/g, " ")}`}
        >
            <div className="catalog-card-image">
                <ItemPhoto photo={collectionPhoto(entry)} decorative />
            </div>
            <div className="catalog-card-caption">
                <div className="catalog-card-meta">
                    <span>{identity.brand ?? (entry.brand ? null : entry.category)}</span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                </div>
                <h3>{identity.heading}</h3>
                {identity.title && <p>{identity.title}</p>}
                <span className="catalog-card-origin">{provenanceLabel(entry)}</span>
            </div>
        </button>
    );
}
export function CollectionDetail({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }) {
    const identity = catalogIdentity(entry);
    const { data } = useDashboard();
    const item = data?.snapshot?.items.find((item) => item.id === entry.shoppingItemId);
    const images = catalogImages(entry);
    const [imageIndex, setImageIndex] = useState(0);
    const image = images[imageIndex] ?? images[0];
    return (
        <Modal
            title={entry.title}
            onClose={onClose}
            className={`catalog-detail ${entry.kind === "note" ? "catalog-detail-note" : ""}`}
        >
            {entry.kind !== "note" && (
                <div className="catalog-gallery">
                    <ItemPhoto photo={image ? imagePhoto(image) : collectionPhoto(entry)} detail />
                    {images.length > 1 && (
                        <div
                            className="catalog-gallery-thumbnails"
                            role="group"
                            aria-label="Fotos del objeto"
                        >
                            {images.map((image, index) => (
                                <button
                                    key={`${image.path}-${index}`}
                                    aria-label={`Ver foto ${index + 1}`}
                                    aria-pressed={imageIndex === index}
                                    onClick={() => setImageIndex(index)}
                                >
                                    <ItemPhoto photo={imagePhoto(image)} decorative />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <div className="detail-text">
                <p className="eyebrow">
                    {entry.category} · {provenanceLabel(entry)}
                </p>
                {identity.brand && <p className="catalog-detail-brand">{identity.brand}</p>}
                <h2>{identity.heading}</h2>
                {identity.title && <p className="detail-subtitle">{identity.title}</p>}
                {identity.subtitle && <p className="detail-subtitle">{identity.subtitle}</p>}
                {entry.ownership === "reference" && (
                    <span className="detail-label">Modelo de referencia</span>
                )}
                {entry.body && <p className="detail-body">{entry.body}</p>}
                {entry.materials?.length ? (
                    <DetailSection title="Materiales y características">
                        {entry.materials.join(" · ")}
                    </DetailSection>
                ) : null}
                {entry.reason && entry.reason !== entry.body && (
                    <DetailSection title="Criterio de selección">{entry.reason}</DetailSection>
                )}
                {item && (
                    <section className="catalog-linked-need">
                        <h3>
                            {entry.shoppingRelation === "contextual"
                                ? "Necesidad relacionada"
                                : "En la lista de compras"}
                        </h3>
                        <p>{item.name}</p>
                        <div className="detail-badges">
                            <Badge value={item.origin} />
                            <Badge value={item.priority} />
                            <Badge value={item.status} />
                        </div>
                        <dl className="detail-quantities">
                            <div>
                                <dt>Para empezar</dt>
                                <dd>{item.initialQuantity || "Por definir"}</dd>
                            </div>
                            <div>
                                <dt>Objetivo</dt>
                                <dd>{item.targetQuantity || "Por definir"}</dd>
                            </div>
                        </dl>
                        {item.quality && (
                            <DetailSection title="Calidad mínima">{item.quality}</DetailSection>
                        )}
                        {item.condition && (
                            <DetailSection title="Antes de comprar">{item.condition}</DetailSection>
                        )}
                        <Link
                            to="/lista"
                            hash={`compra-${item.id}`}
                            className="text-link"
                            onClick={onClose}
                        >
                            Abrir en la lista <ArrowUpRight size={14} />
                        </Link>
                    </section>
                )}
                <FeedbackPanel target={{ kind: "collection", id: entry.id }} />
                <div className="detail-actions">
                    {entry.productSource && (
                        <ExternalLink href={entry.productSource.url}>
                            {entry.productSource.title}
                        </ExternalLink>
                    )}
                    <ExternalLink href={entry.source.url}>
                        {/^https:\/\/(?:app\.notion\.com|(?:www\.)?notion\.so)\//.test(
                            entry.source.url,
                        )
                            ? "Ver en Notion"
                            : entry.source.title}
                    </ExternalLink>
                    {item && <ExternalLink href={item.url}>Necesidad en Notion</ExternalLink>}
                </div>
            </div>
        </Modal>
    );
}
function ShoppingCollection({
    items,
    pending,
    failed,
    onOpen,
}: {
    items: ShoppingItem[];
    pending: boolean;
    failed: boolean;
    onOpen: (item: ShoppingItem) => void;
}) {
    if (pending) return <p role="status">Cargando la lista…</p>;
    if (!items.length)
        return (
            <EmptyState
                title={
                    failed ? "No se pudieron cargar los datos." : "No hay un catálogo importado."
                }
            >
                <Link to="/lista" className="text-link">
                    Abrir la lista de compras
                </Link>
            </EmptyState>
        );
    return (
        <>
            <p className="inline-notice">
                El catálogo todavía no está disponible. Estas son las necesidades registradas en
                Notion.
            </p>
            <div className="catalog-grid">
                {items.map((item) => (
                    <button
                        id={`compra-${item.id}`}
                        key={item.id}
                        className="catalog-card"
                        onClick={() => onOpen(item)}
                    >
                        <div className="catalog-card-image">
                            <ShoppingPhoto item={item} decorative />
                        </div>
                        <div className="catalog-card-caption">
                            <span className="catalog-card-meta">{item.room}</span>
                            <h3>{item.name}</h3>
                            <Badge value={item.origin} />
                        </div>
                    </button>
                ))}
            </div>
        </>
    );
}
