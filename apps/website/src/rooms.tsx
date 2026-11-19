import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { CollectionEntry, ShoppingItem, MoodboardReference } from "@repo/client";
import { useCollection, useDashboard, useMoodboard } from "./home.queries";
import { CollectionCard, CollectionDetail } from "./collection";
import { CollectionImage, EmptyState, Heading, ShoppingDetail, normalize, Badge } from "./ui";
import { ShoppingPhoto } from "./item-photos";
import { MoodboardDetail } from "./moodboard";
import "./rooms.css";

const roomOrder = [
    "Cocina",
    "Living",
    "Dormitorio",
    "Trabajo",
    "Música y colecciones",
    "Baño",
    "Lavadero",
    "Limpieza",
    "General",
];
export function RoomsPage() {
    const shopping = useDashboard();
    const collection = useCollection();
    const moodboard = useMoodboard();
    const [room, setRoom] = useState("");
    const [selected, setSelected] = useState<CollectionEntry | null>(null);
    const [selectedItem, setSelectedItem] = useState<ShoppingItem | null>(null);
    const [reference, setReference] = useState<MoodboardReference | null>(null);
    const items = shopping.data?.snapshot?.items ?? [];
    const entries = collection.data?.entries ?? [];
    const rooms = [
        ...new Set([
            ...items.map((item) => item.room),
            ...entries.flatMap((entry) => entry.rooms ?? []),
        ]),
    ].sort((a, b) => {
        const rank = (value: string) => (roomOrder.includes(value) ? roomOrder.indexOf(value) : 99);
        return rank(a) - rank(b) || a.localeCompare(b, "es");
    });
    const activeRoom = rooms.includes(room) ? room : rooms[0];
    const roomItems = items.filter((item) => item.room === activeRoom);
    const roomEntries = entries.filter(
        (entry) =>
            entry.kind !== "note" &&
            ((entry.rooms ?? []).includes(activeRoom ?? "") ||
                roomItems.some((item) => item.id === entry.shoppingItemId)),
    );
    const needsWithoutModel = roomItems.filter(
        (item) =>
            !roomEntries.some(
                (entry) => entry.shoppingItemId === item.id && entry.shoppingRelation === "exact",
            ),
    );
    const roomReferences = (moodboard.data?.references ?? []).filter((ref) =>
        ref.rooms.some(
            (value) =>
                normalize(value) === normalize(activeRoom ?? "") ||
                (activeRoom === "Trabajo" && normalize(value) === "estudio"),
        ),
    );
    const publications = new Map<string, MoodboardReference>();
    for (const reference of roomReferences) {
        if (!publications.has(reference.projectKey) || reference.hero)
            publications.set(reference.projectKey, reference);
    }
    const references = [...publications.values()]
        .sort((a, b) => Number(b.collection === "pinterest") - Number(a.collection === "pinterest"))
        .slice(0, 9);
    const criteria = roomItems.filter((item) => item.quality || item.condition);
    return (
        <>
            <Heading title="Ambientes" />
            {shopping.isPending && !rooms.length ? (
                <p role="status">Cargando ambientes…</p>
            ) : !rooms.length ? (
                <EmptyState
                    title={
                        shopping.isError
                            ? "No se pudieron cargar los ambientes."
                            : "No hay ambientes registrados."
                    }
                />
            ) : (
                <>
                    <div className="room-tabs filter-tabs" role="group" aria-label="Ambiente">
                        {rooms.map((value) => (
                            <button
                                key={value}
                                aria-pressed={activeRoom === value}
                                onClick={() => setRoom(value)}
                            >
                                {value}
                            </button>
                        ))}
                    </div>
                    <div className="section-heading room-heading">
                        <h2>{activeRoom}</h2>
                        <Link to="/compras" search={{ room: activeRoom }} className="text-link">
                            Ver en Plan <ArrowUpRight size={15} />
                        </Link>
                    </div>
                    <div className="catalog-grid">
                        {roomEntries.map((entry) => (
                            <CollectionCard
                                key={entry.id}
                                entry={entry}
                                onOpen={() => setSelected(entry)}
                            />
                        ))}
                    </div>
                    {needsWithoutModel.length > 0 && (
                        <section className="room-needs">
                            <h3>Necesidades sin modelo de referencia</h3>
                            <div className="room-need-list">
                                {needsWithoutModel.map((item) => (
                                    <button key={item.id} onClick={() => setSelectedItem(item)}>
                                        <ShoppingPhoto item={item} decorative />
                                        <span>
                                            {item.name}
                                            <small>{item.priority}</small>
                                        </span>
                                        <Badge value={item.origin} />
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                    {criteria.length > 0 && (
                        <section className="room-criteria">
                            <h3>Criterios registrados</h3>
                            {criteria.map((item) => (
                                <details key={item.id}>
                                    <summary>{item.name}</summary>
                                    {item.quality && (
                                        <p>
                                            <strong>Calidad mínima.</strong> {item.quality}
                                        </p>
                                    )}
                                    {item.condition && (
                                        <p>
                                            <strong>Antes de comprar.</strong> {item.condition}
                                        </p>
                                    )}
                                </details>
                            ))}
                        </section>
                    )}
                    {references.length > 0 && (
                        <section className="room-references">
                            <div className="section-heading">
                                <h3>Referencias del ambiente</h3>
                                <Link to="/referencias" className="text-link">
                                    Todas las referencias <ArrowUpRight size={15} />
                                </Link>
                            </div>
                            <div className="room-reference-grid">
                                {references.map((ref) => (
                                    <button key={ref.id} onClick={() => setReference(ref)}>
                                        {ref.thumbnail || ref.image ? (
                                            <CollectionImage
                                                src={(ref.thumbnail ?? ref.image)!}
                                                alt={ref.title}
                                            />
                                        ) : (
                                            <span>Imagen no disponible</span>
                                        )}
                                        <strong>{ref.title}</strong>
                                        <small>{ref.publisher}</small>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}
            {(shopping.isError || collection.isError || moodboard.isError) && rooms.length > 0 && (
                <p className="inline-notice" role="status">
                    No se pudo actualizar parte del contenido de este ambiente.
                </p>
            )}
            {selected && <CollectionDetail entry={selected} onClose={() => setSelected(null)} />}
            {selectedItem && (
                <ShoppingDetail item={selectedItem} onClose={() => setSelectedItem(null)} />
            )}
            {reference && (
                <MoodboardDetail
                    reference={reference}
                    views={
                        moodboard.data?.references.filter(
                            (ref) => ref.projectKey === reference.projectKey,
                        ) ?? [reference]
                    }
                    onSelect={setReference}
                    onClose={() => setReference(null)}
                />
            )}
        </>
    );
}
