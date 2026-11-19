import { ShoppingPhoto, ItemPhoto, collectionPhoto } from "./item-photos";
import { useEffect, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { CollectionEntry, ShoppingItem, MoodboardReference } from "@repo/client";
import { useCollection, useDashboard, useMoodboard } from "./home.queries";
import { useContentIndex } from "./content.queries";
import { catalogText } from "./catalog-model";
import { MoodboardDetail } from "./moodboard";
import { CollectionDetail } from "./collection";
import { Modal, normalize, ShoppingDetail } from "./ui";

export function GlobalSearch() {
    const [open, setOpen] = useState(false);
    const [item, setItem] = useState<ShoppingItem | null>(null);
    const [entry, setEntry] = useState<CollectionEntry | null>(null);
    const [reference, setReference] = useState<MoodboardReference | null>(null);
    useEffect(() => {
        const listener = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((previous) => !previous);
            }
        };
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, []);
    return (
        <>
            <button
                className="global-search-trigger"
                onClick={() => setOpen(true)}
                aria-label="Buscar en Home"
            >
                <Search size={15} />
                <span>Buscar</span>
                <kbd>⌘ K</kbd>
            </button>
            {open && (
                <SearchDialog
                    onClose={() => setOpen(false)}
                    onItem={(item) => {
                        setOpen(false);
                        setItem(item);
                    }}
                    onReference={(reference) => {
                        setOpen(false);
                        setReference(reference);
                    }}
                    onEntry={(entry) => {
                        setOpen(false);
                        setEntry(entry);
                    }}
                />
            )}
            {item && <ShoppingDetail item={item} onClose={() => setItem(null)} />}
            {entry && <CollectionDetail entry={entry} onClose={() => setEntry(null)} />}
            {reference && (
                <MoodboardDetail
                    reference={reference}
                    views={[reference]}
                    onSelect={setReference}
                    onClose={() => setReference(null)}
                />
            )}
        </>
    );
}
function SearchDialog({
    onClose,
    onItem,
    onEntry,
    onReference,
}: {
    onClose: () => void;
    onItem: (item: ShoppingItem) => void;
    onEntry: (entry: CollectionEntry) => void;
    onReference: (reference: MoodboardReference) => void;
}) {
    const [search, setSearch] = useState("");
    const shopping = useDashboard();
    const collection = useCollection();
    const content = useContentIndex();
    const moodboard = useMoodboard();
    const navigate = useNavigate();
    const q = normalize(search);
    const items = (shopping.data?.snapshot?.items ?? []).filter((item) =>
        normalize(`${item.name} ${item.room} ${item.quality}`).includes(q),
    );
    const entries = (collection.data?.entries ?? []).filter((entry) =>
        normalize(catalogText(entry)).includes(q),
    );
    const documents = (content.data?.documents ?? []).filter((document) =>
        normalize(document.searchText).includes(q),
    );
    const references = (moodboard.data?.references ?? [])
        .filter((reference) =>
            normalize(
                [
                    reference.title,
                    reference.publisher,
                    reference.note,
                    ...reference.styles,
                    ...reference.rooms,
                    ...reference.objects,
                ].join(" "),
            ).includes(q),
        )
        .sort(
            (a, b) => Number(b.collection === "pinterest") - Number(a.collection === "pinterest"),
        );
    const failedSources = [
        ...(moodboard.isError ? ["las referencias"] : []),
        ...(shopping.isError ? ["el plan"] : []),
        ...(collection.isError ? ["la colección"] : []),
        ...(content.isError || content.data?.state === "stale" || content.data?.state === "error"
            ? ["los documentos"]
            : []),
    ];
    const unavailable =
        !shopping.isPending &&
        !collection.isPending &&
        !content.isPending &&
        !moodboard.isPending &&
        !shopping.data?.snapshot &&
        !collection.data &&
        !content.data?.syncedAt &&
        !moodboard.data;
    const retrying =
        shopping.isFetching || collection.isFetching || content.isFetching || moodboard.isFetching;
    return (
        <Modal title="Buscar en Home" onClose={onClose} className="search-modal">
            <div className="search-dialog-field">
                <Search size={20} />
                <input
                    data-autofocus
                    aria-label="Buscar en todo Home"
                    placeholder="Buscar objetos, marcas, referencias y notas"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
            <div className="search-results" aria-live="polite">
                {(failedSources.length > 0 || unavailable) && (
                    <div className="search-notice" role="status">
                        <p>
                            {unavailable
                                ? failedSources.length
                                    ? "La búsqueda no está disponible. No se pudieron cargar los datos."
                                    : "No hay datos disponibles para buscar."
                                : `No pudimos actualizar ${failedSources.join(" ni ")}. Los resultados disponibles pueden estar incompletos.`}
                        </p>
                        {failedSources.length > 0 && (
                            <button
                                className="text-button"
                                disabled={retrying}
                                onClick={() => {
                                    if (moodboard.isError) void moodboard.refetch();
                                    if (shopping.isError) void shopping.refetch();
                                    if (collection.isError) void collection.refetch();
                                    if (
                                        content.isError ||
                                        content.data?.state === "stale" ||
                                        content.data?.state === "error"
                                    )
                                        void content.refetch();
                                }}
                            >
                                {retrying ? "Reintentando…" : "Volver a intentar"}
                            </button>
                        )}
                    </div>
                )}
                {entries.length > 0 && (
                    <>
                        <p className="eyebrow">Catálogo y notas</p>
                        {entries.slice(0, 4).map((entry) => (
                            <button key={entry.id} onClick={() => onEntry(entry)}>
                                {entry.kind !== "note" && (
                                    <ItemPhoto photo={collectionPhoto(entry)} decorative />
                                )}
                                <span>
                                    {entry.title.replace(/\n/g, " ")}
                                    <small>{entry.category}</small>
                                </span>
                                <ArrowUpRight size={15} />
                            </button>
                        ))}
                    </>
                )}
                {items.length > 0 && (
                    <>
                        <p className="eyebrow">Compras</p>
                        {items.slice(0, 10).map((item) => (
                            <button key={item.id} onClick={() => onItem(item)}>
                                <ShoppingPhoto item={item} decorative />
                                <span>
                                    {item.name}
                                    <small>
                                        {item.room} · {item.priority}
                                    </small>
                                </span>
                                <ArrowUpRight size={15} />
                            </button>
                        ))}
                    </>
                )}
                {references.length > 0 && (
                    <>
                        <p className="eyebrow">Referencias visuales</p>
                        {references.slice(0, 6).map((reference) => (
                            <button key={reference.id} onClick={() => onReference(reference)}>
                                <span>
                                    {reference.title}
                                    <small>
                                        {reference.publisher} ·{" "}
                                        {reference.collection === "pinterest"
                                            ? "Pinterest"
                                            : "Atlas"}
                                    </small>
                                </span>
                                <ArrowUpRight size={15} />
                            </button>
                        ))}
                    </>
                )}
                {documents.length > 0 && (
                    <>
                        <p className="eyebrow">Documentos</p>
                        {documents.slice(0, 10).map((document) => (
                            <button
                                key={document.id}
                                onClick={() => {
                                    onClose();
                                    void navigate({
                                        to: "/documentos/$documentId",
                                        params: { documentId: document.id },
                                    });
                                }}
                            >
                                <span>{document.title}</span>
                                <ArrowUpRight size={15} />
                            </button>
                        ))}
                    </>
                )}
                {!items.length &&
                    !entries.length &&
                    !documents.length &&
                    !references.length &&
                    !unavailable && (
                        <p className="search-empty">
                            {shopping.isPending ||
                            collection.isPending ||
                            content.isPending ||
                            moodboard.isPending
                                ? "Buscando…"
                                : failedSources.length
                                  ? "No hay coincidencias entre los resultados disponibles."
                                  : "No encontramos nada con ese nombre."}
                        </p>
                    )}
            </div>
            <footer className="search-dialog-footer">
                <span>
                    <kbd>esc</kbd> para cerrar
                </span>
            </footer>
        </Modal>
    );
}
