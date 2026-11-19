import { ShoppingPhoto } from "./item-photos";
import { useContextLink } from "./context-link";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, Search, X } from "lucide-react";
import type { ShoppingItem } from "@repo/client";
import { useDashboard, useSetPurchased } from "./home.queries";
import { Badge, EmptyState, ExternalLink, Heading, normalize, ShoppingDetail } from "./ui";
import { shoppingSource } from "./sources";
import { useSession } from "./auth";
import "./checklist.css";

export function ChecklistPage() {
    const query = useDashboard();
    const session = useSession();
    return (
        <div className="checklist-page">
            <Heading
                title="Lista para la casa"
                action={
                    session?.role === "owner" && (
                        <ExternalLink className="button" href={shoppingSource}>
                            Editar en Notion
                        </ExternalLink>
                    )
                }
            />
            {query.isPending || query.data?.state === "syncing" ? (
                <div className="loading" role="status">
                    <div className="skeleton" />
                    <p>Cargando lista…</p>
                </div>
            ) : query.isError && !query.data ? (
                <EmptyState title="No se pudo cargar la lista.">
                    <button className="button" onClick={() => void query.refetch()}>
                        Volver a intentar
                    </button>
                </EmptyState>
            ) : query.data?.snapshot ? (
                <>
                    {query.isError && (
                        <div className="checklist-notice" role="status">
                            <p>No se pudo actualizar. Mostramos la última lista disponible.</p>
                            <button
                                className="button"
                                disabled={query.isFetching}
                                onClick={() => void query.refetch()}
                            >
                                {query.isFetching ? "Reintentando…" : "Volver a intentar"}
                            </button>
                        </div>
                    )}
                    <Checklist
                        items={query.data.snapshot.items}
                        configured={query.data.configured}
                    />
                </>
            ) : (
                <EmptyState title="Datos de compras no disponibles.">
                    <p>No hay una copia disponible de la lista.</p>
                    <ExternalLink href={shoppingSource}>Abrir Notion</ExternalLink>
                </EmptyState>
            )}
        </div>
    );
}

function Checklist({ items, configured }: { items: ShoppingItem[]; configured: boolean }) {
    const purchase = useSetPurchased();
    const canPurchase = useSession()?.role === "owner";
    const lastToggle = useRef<HTMLInputElement | null>(null);
    const viewControls = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if ((purchase.isSuccess || purchase.isError) && lastToggle.current) {
            if (document.activeElement === document.body) {
                const next = lastToggle.current.isConnected
                    ? lastToggle.current
                    : viewControls.current?.querySelector<HTMLButtonElement>(
                          '[aria-pressed="true"]',
                      );
                next?.focus();
            }
            lastToggle.current = null;
        }
    }, [purchase.isSuccess, purchase.isError]);
    const [search, setSearch] = useState("");
    const [room, setRoom] = useState("");
    const [view, setView] = useState("Todos");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useContextLink("compra", items, (item) => setSelectedId(item.id));
    const purchased = items.filter((item) => item.status === "Comprado").length;
    const selected = items.find((item) => item.id === selectedId);
    const roomName = (item: ShoppingItem) => item.room || "Sin ambiente";
    const rooms = [...new Set(items.map(roomName))].sort((a, b) => a.localeCompare(b, "es"));
    const visible = items.filter(
        (item) =>
            (!room || roomName(item) === room) &&
            (!search ||
                normalize(`${item.name} ${item.notes} ${item.quality}`).includes(
                    normalize(search),
                )) &&
            (view === "Todos" || (item.status === "Comprado") === (view === "Comprados")),
    );
    const groups = Object.entries(Object.groupBy(visible, roomName)).sort(([a], [b]) =>
        a.localeCompare(b, "es"),
    );
    const filtered = Boolean(search || room || view !== "Todos");
    const clear = () => {
        setSearch("");
        setRoom("");
        setView("Todos");
    };
    if (!items.length)
        return (
            <EmptyState title="No hay compras registradas.">
                <p>Los objetos aparecerán desde tu lista de Notion.</p>
                <ExternalLink href={shoppingSource}>Abrir Notion</ExternalLink>
            </EmptyState>
        );
    return (
        <div className="home-checklist">
            <div className="checklist-overview">
                <div className="checklist-progress">
                    <p>
                        <strong>
                            {purchased} de {items.length}
                        </strong>{" "}
                        comprados <span>· {items.length - purchased} pendientes</span>
                    </p>
                    <progress value={purchased} max={items.length} aria-label="Objetos comprados" />
                </div>
                <Link className="text-link" to="/compras">
                    Ver plan <ArrowRight size={15} aria-hidden="true" />
                </Link>
            </div>
            <p className="checklist-help" id="checklist-saving-help">
                {!canPurchase
                    ? "Podés consultar la lista. Los cambios de compra los guarda el propietario."
                    : configured
                      ? "Marcá lo que ya compraste. Los cambios se guardan en Notion."
                      : "Notion sin conectar. Conectá la integración para guardar compras desde esta lista."}
            </p>
            {purchase.isPending && (
                <p className="checklist-save-status" role="status">
                    Guardando en Notion…
                </p>
            )}
            {purchase.isError && (
                <p className="checklist-save-status" role="alert">
                    {purchase.error.message}
                </p>
            )}
            {purchase.isSuccess && (
                <p className="checklist-save-status" role="status">
                    Estado guardado en Notion.
                </p>
            )}
            <div className="checklist-controls">
                <div
                    ref={viewControls}
                    className="filter-tabs"
                    role="group"
                    aria-label="Estado de compra"
                >
                    {["Todos", "Pendientes", "Comprados"].map((value) => (
                        <button
                            key={value}
                            aria-pressed={view === value}
                            onClick={() => setView(value)}
                        >
                            {value}
                        </button>
                    ))}
                </div>
                <label className="search-field">
                    <Search size={16} aria-hidden="true" />
                    <input
                        aria-label="Buscar en la lista"
                        placeholder="Buscar objeto…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </label>
                <select
                    aria-label="Ambiente"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                >
                    <option value="">Todos los ambientes</option>
                    {rooms.map((value) => (
                        <option key={value}>{value}</option>
                    ))}
                </select>
            </div>
            <div className="results-count checklist-results" role="status">
                <span>
                    {visible.length} de {items.length} objetos
                </span>
                {filtered && (
                    <button onClick={clear}>
                        Limpiar filtros <X size={13} aria-hidden="true" />
                    </button>
                )}
            </div>
            {groups.length ? (
                <div className="checklist-rooms">
                    {groups.map(([name, rows]) => (
                        <section className="checklist-room" key={name} aria-label={name}>
                            <header>
                                <h2>{name}</h2>
                                <span>
                                    {rows!.length} {rows!.length === 1 ? "objeto" : "objetos"}
                                </span>
                            </header>
                            <ul>
                                {rows!
                                    .toSorted(
                                        (a, b) =>
                                            Number(a.status === "Comprado") -
                                            Number(b.status === "Comprado"),
                                    )
                                    .map((item) => (
                                        <ChecklistItem
                                            key={item.id}
                                            item={item}
                                            onOpen={() => setSelectedId(item.id)}
                                            disabled={
                                                !canPurchase || !configured || purchase.isPending
                                            }
                                            onToggle={(checkbox) => {
                                                lastToggle.current = checkbox;
                                                purchase.mutate({
                                                    id: item.id,
                                                    purchased: item.status !== "Comprado",
                                                    expectedStatus: item.status,
                                                });
                                            }}
                                        />
                                    ))}
                            </ul>
                        </section>
                    ))}
                </div>
            ) : (
                <EmptyState title="No hay objetos con estos filtros.">
                    <button className="button" onClick={clear}>
                        Ver todos los objetos
                    </button>
                </EmptyState>
            )}
            {selected && <ShoppingDetail item={selected} onClose={() => setSelectedId(null)} />}
        </div>
    );
}

function ChecklistItem({
    item,
    onOpen,
    disabled,
    onToggle,
}: {
    item: ShoppingItem;
    onOpen: () => void;
    disabled: boolean;
    onToggle: (checkbox: HTMLInputElement) => void;
}) {
    const purchased = item.status === "Comprado";
    return (
        <li id={`compra-${item.id}`} className={`checklist-row ${purchased ? "is-purchased" : ""}`}>
            <label className="checklist-toggle">
                <input
                    type="checkbox"
                    checked={purchased}
                    disabled={disabled}
                    onChange={(event) => onToggle(event.currentTarget)}
                    aria-label={`Marcar ${item.name} como ${purchased ? "pendiente" : "comprado"}`}
                    aria-describedby="checklist-saving-help"
                />
            </label>
            <button
                className="checklist-item"
                onClick={onOpen}
                aria-label={`${item.name}. ${item.status || "Estado sin definir"}. Ver detalles`}
            >
                <ShoppingPhoto item={item} decorative />
                <span className="checklist-item-content">
                    <span className="checklist-item-name">{item.name}</span>
                    <span className="checklist-item-meta">
                        {item.priority && <span>{item.priority}</span>}
                        {item.initialQuantity && <span>Para empezar: {item.initialQuantity}</span>}
                        <span>{item.status || "Estado sin definir"}</span>
                    </span>
                </span>
                {item.origin && <Badge value={item.origin} />}
                <ChevronRight size={16} aria-hidden="true" />
            </button>
        </li>
    );
}
