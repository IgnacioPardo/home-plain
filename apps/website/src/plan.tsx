import { ShoppingPhoto } from "./item-photos";
import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { ShoppingItem } from "@repo/client";
import {
    Badge,
    DataBoundary,
    EmptyState,
    ExternalLink,
    formatPrice,
    Heading,
    normalize,
    ShoppingDetail,
} from "./ui";
import { shoppingSource } from "./sources";

export type PlanSearch = {
    q?: string;
    room?: string;
    priority?: string;
    origin?: string;
    status?: string;
};
export function validatePlanSearch(search: Record<string, unknown>): PlanSearch {
    return Object.fromEntries(
        ["q", "room", "priority", "origin", "status"].flatMap((key) =>
            typeof search[key] === "string" && search[key] ? [[key, search[key]]] : [],
        ),
    );
}
export function PlanPage() {
    return (
        <>
            <Heading
                title="Plan de compras"
                action={
                    <ExternalLink className="button" href={shoppingSource}>
                        Editar en Notion
                    </ExternalLink>
                }
            />
            <DataBoundary>
                {(data) =>
                    data.snapshot ? (
                        <PlanContent items={data.snapshot.items} />
                    ) : (
                        <EmptyState title="Datos de compras no disponibles.">
                            <p>No hay una copia disponible de la lista.</p>
                            <ExternalLink href={shoppingSource}>Abrir Notion</ExternalLink>
                        </EmptyState>
                    )
                }
            </DataBoundary>
        </>
    );
}
function PlanContent({ items }: { items: ShoppingItem[] }) {
    const filters = useSearch({ from: "/compras" });
    const navigate = useNavigate({ from: "/compras" });
    const [selected, setSelected] = useState<ShoppingItem | null>(null);
    const change = (key: keyof PlanSearch, value: string) => {
        void navigate({
            search: (previous) => ({ ...previous, [key]: value || undefined }),
            replace: true,
        });
    };
    const visible = items.filter(
        (item) =>
            (!filters.q ||
                normalize(`${item.name} ${item.notes} ${item.quality}`).includes(
                    normalize(filters.q),
                )) &&
            (!filters.room || item.room === filters.room) &&
            (!filters.priority || item.priority === filters.priority) &&
            (!filters.origin || item.origin === filters.origin) &&
            (!filters.status || item.status === filters.status),
    );
    const active = Object.values(filters).some(Boolean);
    return (
        <>
            <PlanSummary items={items} />
            <div className="plan-layout">
                <section className="plan-list">
                    <div className="plan-filters">
                        <label className="search-field">
                            <Search size={16} />
                            <input
                                aria-label="Buscar compras"
                                value={filters.q ?? ""}
                                onChange={(e) => change("q", e.target.value)}
                                placeholder="Buscar en el plan…"
                            />
                        </label>
                        <div className="select-filters">
                            <SelectFilter
                                label="Ambiente"
                                value={filters.room}
                                values={items.map((i) => i.room)}
                                onChange={(v) => change("room", v)}
                            />
                            <SelectFilter
                                label="Prioridad"
                                value={filters.priority}
                                values={items.map((i) => i.priority)}
                                onChange={(v) => change("priority", v)}
                            />
                            <SelectFilter
                                label="Definición"
                                value={filters.origin}
                                values={items.map((i) => i.origin)}
                                onChange={(v) => change("origin", v)}
                            />
                            <SelectFilter
                                label="Estado"
                                value={filters.status}
                                values={items.map((i) => i.status)}
                                onChange={(v) => change("status", v)}
                            />
                        </div>
                    </div>
                    <div className="results-count" role="status">
                        {visible.length} de {items.length} objetos
                        {active && (
                            <button onClick={() => void navigate({ search: {}, replace: true })}>
                                Limpiar
                                <X size={12} />
                            </button>
                        )}
                    </div>
                    {visible.length ? (
                        <div className="table-scroll">
                            <table className="plan-table" role="table" aria-label="Plan de compras">
                                <thead role="rowgroup">
                                    <tr role="row">
                                        <th role="columnheader" scope="col">
                                            Objeto
                                        </th>
                                        <th role="columnheader" scope="col">
                                            Prioridad
                                        </th>
                                        <th role="columnheader" scope="col">
                                            Definición
                                        </th>
                                        <th role="columnheader" scope="col">
                                            Estado
                                        </th>
                                        <th role="columnheader" scope="col">
                                            Precio
                                        </th>
                                    </tr>
                                </thead>
                                <tbody role="rowgroup">
                                    {visible.map((item) => (
                                        <tr key={item.id} role="row">
                                            <td role="cell">
                                                <button
                                                    className="item-name"
                                                    onClick={() => setSelected(item)}
                                                >
                                                    <ShoppingPhoto item={item} decorative />
                                                    <span>
                                                        {item.name}
                                                        <small>{item.room}</small>
                                                    </span>
                                                    <ArrowUpRight size={14} />
                                                </button>
                                            </td>
                                            <td role="cell">
                                                <span
                                                    className="mobile-cell-label"
                                                    aria-hidden="true"
                                                >
                                                    Prioridad
                                                </span>
                                                <Badge value={item.priority} />
                                            </td>
                                            <td role="cell">
                                                <span
                                                    className="mobile-cell-label"
                                                    aria-hidden="true"
                                                >
                                                    Definición
                                                </span>
                                                <Badge value={item.origin} />
                                            </td>
                                            <td role="cell">
                                                <span
                                                    className="mobile-cell-label"
                                                    aria-hidden="true"
                                                >
                                                    Estado
                                                </span>
                                                <span className="state-text">{item.status}</span>
                                            </td>
                                            <td className="price" role="cell">
                                                <span
                                                    className="mobile-cell-label"
                                                    aria-hidden="true"
                                                >
                                                    Precio
                                                </span>
                                                {item.estimatedPriceArs === null
                                                    ? "Por cotizar"
                                                    : formatPrice(item.estimatedPriceArs)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <EmptyState
                            title={
                                active
                                    ? "No hay objetos con estos filtros."
                                    : "No hay compras registradas."
                            }
                        >
                            <p>
                                {active
                                    ? "Probá otro ambiente o quitá un filtro."
                                    : "Los objetos aparecerán desde tu lista de Notion."}
                            </p>
                        </EmptyState>
                    )}
                    <p className="table-footnote">
                        Confirmado describe la necesidad. Marca, medidas y precio pueden seguir
                        abiertos.
                    </p>
                </section>
                <PlanInsights items={items} />
            </div>
            {selected && <ShoppingDetail item={selected} onClose={() => setSelected(null)} />}
        </>
    );
}
function SelectFilter({
    label,
    value,
    values,
    onChange,
}: {
    label: string;
    value?: string;
    values: string[];
    onChange: (value: string) => void;
}) {
    return (
        <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">{label}</option>
            {[...new Set(values)].sort().map((value) => (
                <option key={value}>{value}</option>
            ))}
        </select>
    );
}
function PlanSummary({ items }: { items: ShoppingItem[] }) {
    const essential = items.filter(
        (item) => item.priority === "Esencial" && item.status !== "Comprado",
    ).length;
    const later = items.filter((item) => item.priority === "Segunda etapa").length;
    const conditional = items.filter((item) => item.status === "Depende del depto").length;
    return (
        <div className="plan-summary">
            {[
                { label: "En el plan", value: items.length },
                { label: "Esenciales pendientes", value: essential },
                { label: "Segunda etapa", value: later },
                { label: "Dependen del lugar", value: conditional },
            ].map((s) => (
                <div key={s.label}>
                    <strong>{s.value}</strong>
                    <span>{s.label}</span>
                </div>
            ))}
        </div>
    );
}
function PlanInsights({ items }: { items: ShoppingItem[] }) {
    const rooms = Object.entries(Object.groupBy(items, (item) => item.room)).sort(
        (a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0),
    );
    const quoted = items.filter((item) => item.estimatedPriceArs !== null);
    return (
        <aside className="plan-insights">
            <section>
                <h2>Por ambiente</h2>
                <div className="room-bars">
                    {rooms.map(([room, rows]) => (
                        <div key={room}>
                            <span>
                                {room}
                                <b>{rows?.length}</b>
                            </span>
                            <div>
                                <i
                                    style={{
                                        width: `${((rows?.length ?? 0) / Math.max(...rooms.map(([, r]) => r?.length ?? 0), 1)) * 100}%`,
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </section>
            <section className="budget-note">
                <h2>Precios</h2>
                <p>
                    {quoted.length
                        ? `${quoted.length} artículos con precio registrado en Notion.`
                        : "No hay precios registrados en Notion."}
                </p>
                <ExternalLink href={shoppingSource}>Abrir en Notion</ExternalLink>
            </section>
        </aside>
    );
}
