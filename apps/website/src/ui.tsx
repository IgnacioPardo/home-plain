import { ShoppingPhoto, ShoppingReferenceInfo } from "./item-photos";
import { FeedbackPanel } from "./feedback";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw, X } from "lucide-react";
import type { ShoppingDashboard, ShoppingItem } from "@repo/client";
import { useDashboard, useRefresh } from "./home.queries";

export function Heading({ title, action }: { title: string; action?: ReactNode }) {
    return (
        <header className="page-heading">
            <h1>{title}</h1>
            {action}
        </header>
    );
}
export function ExternalLink({
    href,
    children,
    className = "text-link",
}: {
    href: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <a href={href} className={className} target="_blank" rel="noreferrer">
            {children}
            <ArrowUpRight size={14} aria-hidden="true" />
        </a>
    );
}
export function DataBoundary({ children }: { children: (data: ShoppingDashboard) => ReactNode }) {
    const query = useDashboard();
    if (query.isPending)
        return (
            <div className="loading" role="status">
                <div className="skeleton" />
                <p>Cargando…</p>
            </div>
        );
    if (query.isError)
        return (
            <EmptyState title="No se pudieron cargar los datos.">
                <button className="button" onClick={() => void query.refetch()}>
                    Volver a intentar
                </button>
            </EmptyState>
        );
    return <>{children(query.data)}</>;
}
export function SyncStatus() {
    const query = useDashboard();
    const refresh = useRefresh();
    if (!query.data)
        return (
            <span className="sync-label">
                {query.isError ? "Sin conexión con Home" : "Conectando…"}
            </span>
        );
    const data = query.data;
    const labels = {
        live: "Al día con Notion",
        offline: "Copia local de Notion",
        stale: "Última copia disponible",
        unconfigured: "Notion sin conectar",
        error: "Sin conexión con Notion",
        syncing: "Sincronizando con Notion…",
    };
    const date = data.snapshot
        ? new Date(data.snapshot.syncedAt).toLocaleString("es-AR", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
          })
        : null;
    return (
        <div className="sync-status">
            <span className={`status-dot ${data.state === "live" ? "live" : ""}`} />
            <span>
                {labels[data.state]}
                {date && <span className="sync-date"> · {date}</span>}
            </span>
            <button
                disabled={!data.configured || refresh.isPending}
                onClick={() => refresh.mutate()}
                aria-label="Actualizar desde Notion"
                title={
                    data.configured
                        ? "Actualizar desde Notion"
                        : "La sincronización automática todavía no está conectada"
                }
            >
                <RefreshCw size={13} className={refresh.isPending ? "spin" : ""} />
            </button>
            {refresh.isError && <span role="alert">No se pudo actualizar.</span>}
        </div>
    );
}
export function Badge({ value }: { value: string }) {
    const tone =
        value === "Confirmado" || value === "Comprado"
            ? "green"
            : value === "Condicionado" || value === "Depende del depto"
              ? "amber"
              : value === "Esencial"
                ? "rust"
                : "neutral";
    return (
        <span className={`badge badge-${tone}`}>
            <i aria-hidden="true" />
            {value}
        </span>
    );
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
    return (
        <div className="empty-state">
            <h2>{title}</h2>
            {children}
        </div>
    );
}
export function Modal({
    title,
    onClose,
    children,
    className = "",
}: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    className?: string;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const node = dialog.current;
        const previousFocus = document.activeElement;
        node?.showModal();
        node?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus();
        return () => {
            node?.close();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
                previousFocus.focus();
            }
        };
    }, []);
    return (
        <dialog
            ref={dialog}
            className={`modal ${className}`}
            aria-label={title}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="modal-content">
                <button className="close-button" onClick={onClose} aria-label="Cerrar">
                    <X size={20} />
                </button>
                {children}
            </div>
        </dialog>
    );
}
export function ShoppingDetail({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
    return (
        <Modal title={item.name} onClose={onClose}>
            <div className="detail-text">
                <ShoppingPhoto item={item} detail />
                <ShoppingReferenceInfo item={item} />
                <p className="eyebrow">{item.room}</p>
                <h2>{item.name}</h2>
                <div className="detail-badges">
                    <Badge value={item.priority} />
                    <Badge value={item.origin} />
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
                {item.notes && <DetailSection title="Notas">{item.notes}</DetailSection>}
                <div className="detail-price">
                    <span>Precio registrado</span>
                    <strong>
                        {item.estimatedPriceArs === null
                            ? "Sin cotizar"
                            : formatPrice(item.estimatedPriceArs)}
                    </strong>
                </div>
                <FeedbackPanel target={{ kind: "shopping", id: item.id }} />
                <div className="detail-actions">
                    <ExternalLink href={item.url}>Abrir ficha en Notion</ExternalLink>
                    {item.reference && (
                        <ExternalLink href={item.reference}>Ver referencia</ExternalLink>
                    )}
                </div>
            </div>
        </Modal>
    );
}
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="detail-section">
            <h3>{title}</h3>
            <p>{children}</p>
        </section>
    );
}
export function formatPrice(value: number) {
    return value.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
    });
}
export function normalize(value: string) {
    return value
        .toLocaleLowerCase("es")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}
export function CollectionImage({
    src,
    alt,
    eager = false,
}: {
    src: string;
    alt: string;
    eager?: boolean;
}) {
    const [failed, setFailed] = useState(false);
    return failed ? (
        <span className="image-fallback">Imagen no disponible · {alt}</span>
    ) : (
        <img
            src={src}
            alt={alt}
            loading={eager ? "eager" : "lazy"}
            onError={() => setFailed(true)}
        />
    );
}
