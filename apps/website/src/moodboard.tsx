import { useContextLink } from "./context-link";
import { FeedbackPanel } from "./feedback";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import type { MoodboardReference, MoodboardSnapshot } from "@repo/client";
import { useMoodboard } from "./home.queries";
import { CollectionImage, EmptyState, ExternalLink, Heading, Modal, normalize } from "./ui";
import "./moodboard.css";

const pageSize = 48;
const emptyFilters = { query: "", style: "", room: "", object: "", publisher: "", allViews: false };
type Filters = typeof emptyFilters;

export function MoodboardPage() {
    const query = useMoodboard();
    return (
        <>
            <Heading title="Referencias" />
            {query.isPending ? (
                <p role="status">Cargando las referencias…</p>
            ) : query.isError ? (
                <EmptyState title="No se pudieron cargar las referencias.">
                    <button className="button" onClick={() => void query.refetch()}>
                        Volver a intentar
                    </button>
                </EmptyState>
            ) : query.data ? (
                <MoodboardBrowser snapshot={query.data} />
            ) : (
                <EmptyState title="No hay referencias importadas.">
                    <p>Importá un catálogo de referencias para ver sus imágenes y fuentes.</p>
                </EmptyState>
            )}
        </>
    );
}

function MoodboardBrowser({ snapshot }: { snapshot: MoodboardSnapshot }) {
    const [filters, setFilters] = useState<Filters>(emptyFilters);
    const [limit, setLimit] = useState(pageSize);
    const [selected, setSelected] = useState<MoodboardReference | null>(null);
    const [collection, setCollection] = useState<"pinterest" | "atlas">(() =>
        snapshot.references.some((ref) => ref.collection === "pinterest") ? "pinterest" : "atlas",
    );
    const references = snapshot.references.filter(
        (ref) => (ref.collection ?? "atlas") === collection,
    );
    const source = snapshot.collections?.find((entry) => entry.id === collection);
    useContextLink("referencia", snapshot.references, (reference) => {
        setCollection(reference.collection ?? "atlas");
        setSelected(reference);
    });
    const options = (key: "styles" | "rooms" | "objects" | "publisher") =>
        [...new Set(references.flatMap((ref) => ref[key]))].sort((a, b) =>
            a.localeCompare(b, "es"),
        );
    const matching = references.filter(
        (ref) =>
            (!filters.style || ref.styles.includes(filters.style)) &&
            (!filters.room || ref.rooms.includes(filters.room)) &&
            (!filters.object || ref.objects.includes(filters.object)) &&
            (!filters.publisher || ref.publisher === filters.publisher) &&
            (!filters.query ||
                normalize(
                    [
                        ref.title,
                        ref.publisher,
                        ref.note,
                        ...ref.styles,
                        ...ref.rooms,
                        ...ref.objects,
                    ].join(" "),
                ).includes(normalize(filters.query))),
    );
    const publications = new Map<string, MoodboardReference>();
    for (const ref of matching)
        if (!publications.has(ref.projectKey) || ref.hero) publications.set(ref.projectKey, ref);
    const visible = filters.allViews ? matching : [...publications.values()];
    const change = (value: Partial<Filters>) => {
        setFilters((current) => ({ ...current, ...value }));
        setLimit(pageSize);
    };
    const missing = references.filter((ref) => !ref.image && !ref.thumbnail).length;
    return (
        <>
            <div
                className="filter-tabs reference-collections"
                role="group"
                aria-label="Colección de referencias"
            >
                {(
                    [
                        ["pinterest", "Pinterest"],
                        ["atlas", "Atlas"],
                    ] as const
                )
                    .filter(([id]) =>
                        snapshot.references.some((ref) => (ref.collection ?? "atlas") === id),
                    )
                    .map(([id, label]) => (
                        <button
                            key={id}
                            aria-pressed={collection === id}
                            onClick={() => {
                                setCollection(id);
                                change(emptyFilters);
                            }}
                        >
                            {label}
                        </button>
                    ))}
            </div>
            <div className="moodboard-provenance">
                <div>
                    <p>
                        {references.length.toLocaleString("es-AR")} imágenes ·{" "}
                        {new Set(references.map((ref) => ref.projectKey)).size} publicaciones
                    </p>
                    <p>
                        Importado el{" "}
                        {new Date(source?.importedAt ?? snapshot.importedAt).toLocaleDateString(
                            "es-AR",
                        )}
                        .
                    </p>
                    {missing > 0 && (
                        <p>{missing} vistas conservan su referencia sin una imagen local.</p>
                    )}
                </div>
                <div className="moodboard-source-links">
                    <ExternalLink href={source?.url ?? snapshot.source.url}>
                        {collection === "pinterest" ? "Investigación en Notion" : "Atlas original"}
                    </ExternalLink>
                    {collection === "atlas" && snapshot.source.conversation && (
                        <ExternalLink href={snapshot.source.conversation}>
                            Conversación y PDF
                        </ExternalLink>
                    )}
                </div>
            </div>
            <div className="moodboard-filters">
                <label className="moodboard-search">
                    Buscar
                    <input
                        type="search"
                        placeholder="Vinilos, cromo, cocina…"
                        value={filters.query}
                        onChange={(event) => change({ query: event.target.value })}
                    />
                </label>
                {(
                    [
                        ["style", "Dirección", "styles"],
                        ["room", "Ambiente", "rooms"],
                        ["object", "Objeto", "objects"],
                        ["publisher", "Fuente", "publisher"],
                    ] as const
                ).map(([key, label, field]) => (
                    <label key={key}>
                        {label}
                        <select
                            value={filters[key]}
                            onChange={(event) => change({ [key]: event.target.value })}
                        >
                            <option value="">Sin filtro</option>
                            {options(field).map((value) => (
                                <option key={value}>{value}</option>
                            ))}
                        </select>
                    </label>
                ))}
            </div>
            <div className="moodboard-results">
                <label>
                    <input
                        type="checkbox"
                        checked={filters.allViews}
                        onChange={(event) => change({ allViews: event.target.checked })}
                    />
                    Mostrar todas las vistas
                </label>
                <span role="status">
                    {visible.length.toLocaleString("es-AR")}{" "}
                    {filters.allViews ? "vistas" : "publicaciones"}
                </span>
                <button className="text-button" onClick={() => change(emptyFilters)}>
                    Limpiar filtros
                </button>
            </div>
            {visible.length ? (
                <>
                    <div className="moodboard-grid">
                        {visible.slice(0, limit).map((ref) => (
                            <button
                                id={`referencia-${ref.id}`}
                                className="moodboard-card"
                                key={ref.id}
                                onClick={() => setSelected(ref)}
                                aria-label={`Ver ${ref.title}`}
                            >
                                <div className="moodboard-card-image">
                                    {ref.thumbnail || ref.image ? (
                                        <CollectionImage
                                            src={(ref.thumbnail ?? ref.image)!}
                                            alt={ref.title}
                                        />
                                    ) : (
                                        <span>Imagen no disponible</span>
                                    )}
                                </div>
                                <div className="moodboard-card-caption">
                                    <span className="moodboard-label">
                                        {ref.styles.join(" · ") || "Sin dirección"}
                                    </span>
                                    <h2>{ref.title}</h2>
                                    <span className="moodboard-publisher">
                                        {ref.publisher}
                                        <ArrowUpRight size={14} aria-hidden="true" />
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="moodboard-more">
                        <p>
                            {Math.min(limit, visible.length)} de{" "}
                            {visible.length.toLocaleString("es-AR")}
                        </p>
                        {visible.length > limit && (
                            <button
                                className="button"
                                onClick={() => setLimit((value) => value + pageSize)}
                            >
                                Ver más referencias
                            </button>
                        )}
                    </div>
                </>
            ) : (
                <EmptyState title="No hay referencias con esos filtros.">
                    <button className="text-button" onClick={() => change(emptyFilters)}>
                        Limpiar filtros
                    </button>
                </EmptyState>
            )}
            {selected && (
                <MoodboardDetail
                    reference={selected}
                    views={references.filter((ref) => ref.projectKey === selected.projectKey)}
                    onSelect={setSelected}
                    onClose={() => setSelected(null)}
                />
            )}
        </>
    );
}

export function MoodboardDetail({
    reference,
    views,
    onSelect,
    onClose,
}: {
    reference: MoodboardReference;
    views: MoodboardReference[];
    onSelect: (reference: MoodboardReference) => void;
    onClose: () => void;
}) {
    const index = views.findIndex((ref) => ref.id === reference.id);
    return (
        <Modal title={reference.title} onClose={onClose} className="moodboard-detail">
            <div className="moodboard-detail-image">
                {reference.image || reference.thumbnail ? (
                    <CollectionImage
                        key={reference.id}
                        src={(reference.image ?? reference.thumbnail)!}
                        alt={reference.title}
                        eager
                    />
                ) : (
                    <p>Esta vista no tiene una imagen local. Podés consultar su fuente.</p>
                )}
            </div>
            <div className="moodboard-detail-text">
                <div className="moodboard-view-controls">
                    <button
                        className="text-button"
                        aria-label="Vista anterior"
                        disabled={index === 0}
                        onClick={() => onSelect(views[index - 1]!)}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <span aria-live="polite">
                        Vista {index + 1} de {views.length}
                    </span>
                    <button
                        className="text-button"
                        aria-label="Vista siguiente"
                        disabled={index === views.length - 1}
                        onClick={() => onSelect(views[index + 1]!)}
                    >
                        <ArrowRight size={18} />
                    </button>
                </div>
                <p className="moodboard-status">
                    {reference.collection === "pinterest" ? "Pinterest" : "Atlas"}
                </p>
                <h2>{reference.title}</h2>
                <p>{reference.styles.join(" · ")}</p>
                <p>
                    {[...reference.rooms, ...reference.objects].join(" · ") ||
                        "Ambiente y objetos sin clasificar"}
                </p>
                <div className="moodboard-palette" aria-label="Paleta de la referencia">
                    {reference.palette.map((color, index) => (
                        <span
                            key={`${color}-${index}`}
                            style={{ backgroundColor: color }}
                            title={color}
                        />
                    ))}
                </div>
                {reference.note && (
                    <section>
                        <h3>
                            {reference.collection === "pinterest"
                                ? "Observación"
                                : "Nota del atlas"}
                        </h3>
                        <p>{reference.note}</p>
                    </section>
                )}
                <FeedbackPanel target={{ kind: "moodboard", id: reference.id }} />
                <ExternalLink href={reference.source}>
                    {reference.publisher} · fuente original
                </ExternalLink>
            </div>
        </Modal>
    );
}
