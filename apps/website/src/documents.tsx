import { useEffect, type ReactNode } from "react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ContentBlock, ContentIndex, ContentText } from "@repo/client";
import { useContentDocument, useContentIndex } from "./content.queries";
import { EmptyState, ExternalLink, Heading } from "./ui";
import { FeedbackPanel } from "./feedback";
import "./documents.css";

export function Documents() {
    const query = useContentIndex();
    return (
        <>
            <ContentStatus data={query.data} failed={query.isError} />
            {query.isPending && <p role="status">Cargando documentos…</p>}
            {query.isError && (
                <button
                    className="text-button"
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                >
                    Volver a intentar
                </button>
            )}
            {!query.isPending &&
                query.data?.state !== "syncing" &&
                !query.data?.documents.length && (
                    <p>No hay una copia disponible de los documentos.</p>
                )}
            <div className="document-grid">
                {query.data?.documents.map((document) => (
                    <Link
                        className="document-card"
                        key={document.id}
                        to="/documentos/$documentId"
                        params={{ documentId: document.id }}
                    >
                        <h3>{document.title}</h3>
                        <span className="document-bottom">
                            Leer documento <ArrowRight size={16} />
                        </span>
                    </Link>
                ))}
                <Link className="document-card" to="/referencias">
                    <h3>Referencias</h3>
                    <span className="document-bottom">
                        Ver referencias <ArrowRight size={16} />
                    </span>
                </Link>
                <Link className="document-card" to="/lista">
                    <h3>Lista de compras</h3>
                    <span className="document-bottom">
                        Ver lista <ArrowRight size={16} />
                    </span>
                </Link>
            </div>
        </>
    );
}

export function DocumentPage() {
    const { documentId } = useParams({ strict: false });
    const hash = useLocation({ select: (location) => location.hash });
    const validDocumentId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        documentId ?? "",
    );
    const query = useContentDocument(documentId ?? "");
    const index = useContentIndex();
    const document = query.data?.document;
    useEffect(() => {
        if (document && /^block-[a-f0-9-]{36}$/i.test(hash))
            globalThis.document.getElementById(hash)?.scrollIntoView();
    }, [document?.id, hash]);
    return (
        <>
            <Link className="text-link" to="/notas">
                Volver a notas
            </Link>
            {!validDocumentId ? (
                <EmptyState title="Documento no disponible.">
                    <p>El enlace no corresponde a un documento compartido.</p>
                </EmptyState>
            ) : query.isPending || query.data?.state === "syncing" ? (
                <p role="status">Cargando documento…</p>
            ) : !document ? (
                <EmptyState title="Documento no disponible.">
                    <p>
                        {query.isError
                            ? "No se pudo cargar este documento compartido."
                            : "La copia de Notion todavía no está disponible."}
                    </p>
                    <button
                        className="button"
                        disabled={query.isFetching}
                        onClick={() => void query.refetch()}
                    >
                        Volver a intentar
                    </button>
                </EmptyState>
            ) : (
                <>
                    <Heading
                        title={document.title}
                        action={<ExternalLink href={document.url}>Fuente en Notion</ExternalLink>}
                    />
                    <ContentStatus data={query.data} failed={query.isError} />
                    <article className="home-document" aria-label={document.title}>
                        <DocumentBlocks
                            blocks={document.blocks}
                            documents={index.data?.documents ?? []}
                            headings={collectHeadings(document.blocks)}
                        />
                    </article>
                    <div className="document-feedback">
                        <FeedbackPanel target={{ kind: "document", id: document.id }} />
                    </div>
                </>
            )}
        </>
    );
}

function ContentStatus({
    data,
    failed,
}: {
    data?: Pick<ContentIndex, "state" | "syncedAt">;
    failed: boolean;
}) {
    if (!data) return failed ? <p role="status">No se pudieron cargar los documentos.</p> : null;
    const label =
        failed || data.state === "stale"
            ? "Última copia disponible; no se pudo confirmar una actualización."
            : data.state === "offline"
              ? "Copia local; Notion no está conectado."
              : data.state === "unconfigured"
                ? "Notion sin conectar."
                : data.state === "syncing"
                  ? "Sincronizando documentos con Notion…"
                  : data.state === "error"
                    ? "No se pudo sincronizar con Notion."
                    : "Al día con Notion.";
    return (
        <p className="document-sync" role="status">
            {label}
            {data.syncedAt && <> Actualizado {new Date(data.syncedAt).toLocaleString("es-AR")}.</>}
        </p>
    );
}

type BlockProps = {
    blocks: ContentBlock[];
    documents: ContentIndex["documents"];
    headings: ContentBlock[];
};
export function DocumentBlocks({ blocks, documents, headings }: BlockProps) {
    const rendered: ReactNode[] = [];
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]!;
        if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
            const items = [block];
            while (blocks[i + 1]?.type === block.type) items.push(blocks[++i]!);
            const Tag = block.type === "numbered_list_item" ? "ol" : "ul";
            rendered.push(
                <Tag key={block.id}>
                    {items.map((item) => (
                        <li id={`block-${item.id}`} key={item.id}>
                            <RichText parts={item.text} documents={documents} />
                            <DocumentBlocks
                                blocks={item.children}
                                documents={documents}
                                headings={headings}
                            />
                        </li>
                    ))}
                </Tag>,
            );
            continue;
        }
        const text = <RichText parts={block.text} documents={documents} />;
        const children = (
            <DocumentBlocks blocks={block.children} documents={documents} headings={headings} />
        );
        const id = `block-${block.id}`;
        switch (block.type) {
            case "heading_1":
            case "heading_2":
            case "heading_3": {
                const Tag =
                    block.type === "heading_1" ? "h2" : block.type === "heading_2" ? "h3" : "h4";
                rendered.push(
                    <div key={id}>
                        <Tag id={id}>{text}</Tag>
                        {children}
                    </div>,
                );
                break;
            }
            case "paragraph":
                rendered.push(
                    <div id={id} key={id}>
                        <p>{text}</p>
                        {children}
                    </div>,
                );
                break;
            case "quote":
                rendered.push(
                    <blockquote id={id} key={id}>
                        {text}
                        {children}
                    </blockquote>,
                );
                break;
            case "callout":
                rendered.push(
                    <aside className="document-callout" id={id} key={id}>
                        {text}
                        {children}
                    </aside>,
                );
                break;
            case "toggle":
                rendered.push(
                    <details id={id} key={id}>
                        <summary>{text}</summary>
                        {children}
                    </details>,
                );
                break;
            case "to_do":
                rendered.push(
                    <div className="document-todo" id={id} key={id}>
                        <input
                            type="checkbox"
                            checked={block.checked}
                            disabled
                            aria-label={block.text.map((part) => part.text).join("") || "Tarea"}
                        />
                        <div>
                            {text}
                            {children}
                        </div>
                    </div>,
                );
                break;
            case "divider":
                rendered.push(<hr id={id} key={id} />);
                break;
            case "table_of_contents":
                rendered.push(
                    <nav aria-label="Índice del documento" id={id} key={id}>
                        <ul>
                            {headings.map((heading) => (
                                <li key={heading.id}>
                                    <a href={`#block-${heading.id}`}>
                                        {heading.text.map((part) => part.text).join("")}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>,
                );
                break;
            case "table":
                rendered.push(
                    <div
                        className="document-table"
                        tabIndex={0}
                        role="region"
                        aria-label="Tabla del documento"
                        id={id}
                        key={id}
                    >
                        <table>
                            <tbody>
                                {block.children.map((row, rowIndex) => (
                                    <tr key={row.id}>
                                        {row.cells.map((cell, cellIndex) => {
                                            const header =
                                                (block.columnHeader && rowIndex === 0) ||
                                                (block.rowHeader && cellIndex === 0);
                                            const Cell = header ? "th" : "td";
                                            return (
                                                <Cell
                                                    key={cellIndex}
                                                    scope={
                                                        header
                                                            ? rowIndex === 0 && block.columnHeader
                                                                ? "col"
                                                                : "row"
                                                            : undefined
                                                    }
                                                >
                                                    <RichText parts={cell} documents={documents} />
                                                </Cell>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>,
                );
                break;
            case "child_page":
                rendered.push(
                    block.targetId &&
                        documents.some((document) => document.id === block.targetId) ? (
                        <p key={id}>
                            <Link
                                to="/documentos/$documentId"
                                params={{ documentId: block.targetId }}
                            >
                                {text}
                            </Link>
                        </p>
                    ) : (
                        <p key={id}>{text}</p>
                    ),
                );
                break;
            case "catalog":
                rendered.push(
                    <p key={id}>
                        <Link to="/">Referencias de productos</Link>
                    </p>,
                );
                break;
            case "shopping":
                rendered.push(
                    <p key={id}>
                        <Link to="/lista">Lista de compras</Link>
                    </p>,
                );
                break;
            case "feedback":
                rendered.push(
                    <p key={id}>
                        <Link to="/notas">Comentarios y notas</Link>
                    </p>,
                );
                break;
            case "column_list":
            case "column":
                rendered.push(
                    <div id={id} key={id}>
                        {children}
                    </div>,
                );
                break;
            default:
                rendered.push(
                    <p className="document-unsupported" id={id} key={id}>
                        Este bloque todavía no se puede mostrar en Home.
                    </p>,
                );
        }
    }
    return <>{rendered}</>;
}

function RichText({
    parts,
    documents,
}: {
    parts: ContentText[];
    documents: ContentIndex["documents"];
}) {
    return (
        <>
            {parts.map((part, i) => {
                let value: ReactNode = part.text;
                if (part.code) value = <code>{value}</code>;
                if (part.bold) value = <strong>{value}</strong>;
                if (part.italic) value = <em>{value}</em>;
                if (part.strikethrough) value = <s>{value}</s>;
                if (part.underline) value = <u>{value}</u>;
                if (part.href?.startsWith("https://")) {
                    const url = new URL(part.href);
                    const target = /(^|\.)notion\.(so|com)$/.test(url.hostname)
                        ? url.pathname
                              .replaceAll("-", "")
                              .match(/([a-f0-9]{32})(?:\/)?$/i)?.[1]
                              ?.toLowerCase()
                        : null;
                    const internal = documents.find(
                        (document) => document.id.replaceAll("-", "") === target,
                    );
                    const fragment = url.hash.slice(1).replaceAll("-", "");
                    const anchor = /^[a-f0-9]{32}$/i.test(fragment)
                        ? `block-${fragment.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase()}`
                        : undefined;
                    if (internal)
                        value = (
                            <Link
                                to="/documentos/$documentId"
                                params={{ documentId: internal.id }}
                                hash={anchor}
                            >
                                {value}
                            </Link>
                        );
                    else
                        value = (
                            <a href={part.href} target="_blank" rel="noreferrer">
                                {value}
                            </a>
                        );
                }
                return <span key={i}>{value}</span>;
            })}
        </>
    );
}
export function collectHeadings(blocks: ContentBlock[]): ContentBlock[] {
    return blocks.flatMap((block) => [
        ...(block.type.startsWith("heading_") ? [block] : []),
        ...collectHeadings(block.children),
    ]);
}
