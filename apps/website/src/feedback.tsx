import { useContextLink } from "./context-link";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { FeedbackEntry, FeedbackTarget } from "@repo/client";
import { useCreateFeedback, useFeedback } from "./feedback.queries";
import "./feedback.css";

import { useSession } from "./auth";
import {
    emptyFeedbackDraft,
    feedbackDraftGeneration,
    feedbackDraftKey,
    feedbackSessionReason,
    readFeedbackDraft,
    storeFeedbackDraft,
    type DraftAccount,
    type FeedbackDraft,
} from "./feedback.drafts";

export function FeedbackPanel({ target }: { target: FeedbackTarget }) {
    const account = useSession();
    return account ? (
        <Discussion key={feedbackDraftKey(account, target)} account={account} target={target} />
    ) : null;
}
export function FeedbackNotes() {
    const account = useSession();
    return account ? (
        <Discussion key={feedbackDraftKey(account, null)} account={account} target={null} />
    ) : null;
}

function Discussion({ target, account }: { target: FeedbackTarget | null; account: DraftAccount }) {
    const query = useFeedback(target);
    const [expandedNote, setExpandedNote] = useState<string | null>(null);
    const [showComposer, setShowComposer] = useState(() => {
        const stored = readFeedbackDraft(feedbackDraftKey(account, target), target);
        return Boolean(target || stored.draft.body || stored.draft.title || stored.error);
    });
    const entries = query.data?.snapshot?.entries ?? [];
    useContextLink("nota", target ? [] : entries, (entry) => setExpandedNote(entry.id));
    return (
        <section
            className={`feedback-panel ${target ? "" : "feedback-notes"}`}
            aria-label={target ? "Comentarios" : "Notas compartidas"}
        >
            <h3>{target ? "Comentarios" : "Notas compartidas"}</h3>
            {query.isPending && <p role="status">Cargando…</p>}
            {query.isError && (
                <p role="alert">
                    No se pudieron cargar los comentarios.{" "}
                    <button className="text-button" onClick={() => void query.refetch()}>
                        Volver a intentar
                    </button>
                </p>
            )}
            {query.data && query.data.state !== "live" && (
                <p className="feedback-notice" role="status">
                    {query.data.state === "syncing"
                        ? "Cargando comentarios desde Notion…"
                        : !query.data.configured
                          ? "Los comentarios todavía no están conectados a Notion."
                          : query.data.snapshot
                            ? "Se muestra la última copia guardada. No se pudo actualizar desde Notion."
                            : "No se pudo leer Notion. Tu texto se conserva si falla el envío."}
                </p>
            )}
            {query.data?.snapshot && (
                <p className="feedback-freshness">
                    Última actualización:{" "}
                    <time dateTime={query.data.snapshot.syncedAt}>
                        {new Date(query.data.snapshot.syncedAt).toLocaleString("es-AR", {
                            dateStyle: "short",
                            timeStyle: "short",
                        })}
                    </time>
                </p>
            )}
            {query.data?.snapshot && !entries.length && (
                <p className="feedback-empty">
                    {target ? "Todavía no hay comentarios." : "Todavía no hay notas compartidas."}
                </p>
            )}
            <ol className="feedback-entries">
                {entries.map((entry) => (
                    <li key={entry.id} id={entry.kind === "note" ? `nota-${entry.id}` : undefined}>
                        <FeedbackEntryView entry={entry} />
                        {entry.kind === "note" && (
                            <>
                                <button
                                    className="text-button"
                                    aria-expanded={expandedNote === entry.id}
                                    onClick={() =>
                                        setExpandedNote(expandedNote === entry.id ? null : entry.id)
                                    }
                                >
                                    {expandedNote === entry.id
                                        ? "Cerrar comentarios"
                                        : "Ver comentarios"}
                                </button>
                                {expandedNote === entry.id && (
                                    <FeedbackPanel target={{ kind: "note", id: entry.id }} />
                                )}
                            </>
                        )}
                    </li>
                ))}
            </ol>
            {!target && (
                <button
                    className="text-button feedback-add-note"
                    aria-expanded={showComposer}
                    disabled={!query.data?.canCreate}
                    onClick={() => setShowComposer(!showComposer)}
                >
                    {showComposer ? "Cerrar borrador" : "Nueva nota"}
                </button>
            )}
            {showComposer && (
                <FeedbackComposer
                    account={account}
                    target={target}
                    enabled={Boolean(query.data?.canCreate)}
                />
            )}
        </section>
    );
}
function FeedbackEntryView({ entry }: { entry: FeedbackEntry }) {
    return (
        <article className="feedback-entry">
            {entry.kind === "note" && <h4>{entry.title}</h4>}
            <p className="feedback-meta">
                <strong>{entry.displayAuthor}</strong>
                <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString("es-AR", {
                        dateStyle: "short",
                        timeStyle: "short",
                    })}
                </time>
            </p>
            <p className="feedback-body">{entry.body}</p>
        </article>
    );
}
function FeedbackComposer({
    account,
    target,
    enabled,
}: {
    account: DraftAccount;
    target: FeedbackTarget | null;
    enabled: boolean;
}) {
    const key = feedbackDraftKey(account, target);
    const [initial] = useState(() => readFeedbackDraft(key, target));
    const [draft, setDraft] = useState<FeedbackDraft>(initial.draft);
    const [storageError, setStorageError] = useState(initial.error);
    const [recoveryError] = useState(initial.error);
    const updateDraft = (next: FeedbackDraft) => {
        setDraft(next);
        setStorageError(!storeFeedbackDraft(key, next));
    };
    const [message, setMessage] = useState("");
    const save = useCreateFeedback();
    const id = useId();
    useEffect(() => {
        const clear = (event: Event) => {
            if (feedbackSessionReason(event) !== "refreshed") setDraft(emptyFeedbackDraft());
            setMessage("");
        };
        window.addEventListener("home:session-cleared", clear);
        return () => window.removeEventListener("home:session-cleared", clear);
    }, [key, target]);
    const submitted = draft.submission !== null;
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (save.isPending || !enabled || recoveryError) return;
        const generation = feedbackDraftGeneration();
        const submission = draft.submission ?? {
            operationId: crypto.randomUUID(),
            kind: target ? ("comment" as const) : ("note" as const),
            displayAuthor: draft.displayAuthor,
            title: target ? "" : draft.title.trim(),
            body: draft.body.trim(),
            target,
        };
        const pending = { ...draft, submission };
        setDraft(pending);
        if (!storeFeedbackDraft(key, pending)) {
            setStorageError(true);
            setMessage(
                "No se pudo conservar el envío en esta pestaña. No se envió a Notion; copiá tu texto antes de recargar.",
            );
            return;
        }
        setStorageError(false);
        setMessage("");
        try {
            const result = await save.mutateAsync(submission);
            if (generation !== feedbackDraftGeneration()) return;
            if (result.status === "saved") {
                const cleared = { ...draft, title: "", body: "", submission: null };
                updateDraft(cleared);
                setMessage(target ? "Comentario guardado." : "Nota guardada.");
            } else
                setMessage(
                    "Guardado pendiente de confirmar. Tu texto se conserva; comprobá este envío antes de crear otro.",
                );
        } catch (error) {
            if (generation !== feedbackDraftGeneration()) return;
            setMessage(
                error instanceof Error
                    ? error.message
                    : "No se pudo confirmar el guardado. Tu texto se conserva.",
            );
        }
    }
    return (
        <form
            className="feedback-form"
            onSubmit={(event) => void submit(event)}
            aria-label={target ? "Agregar comentario" : "Nueva nota"}
        >
            {!target && <h4>Nueva nota</h4>}
            {initial.recovered && (draft.body || draft.title || draft.submission) && (
                <p className="feedback-hint" role="status">
                    Borrador recuperado de esta pestaña.{" "}
                    {draft.submission
                        ? "Comprobá el envío pendiente antes de crear otro."
                        : "Podés continuar escribiendo."}
                </p>
            )}
            {storageError && (
                <p role="alert">
                    {recoveryError
                        ? "No se pudo recuperar este borrador con seguridad. Revisá el guardado antes de iniciar otro envío."
                        : "No se pudo conservar el borrador en esta pestaña. Copiá tu texto antes de recargar."}
                </p>
            )}
            <label htmlFor={`${id}-author`}>Nombre mostrado</label>
            <select
                id={`${id}-author`}
                value={draft.displayAuthor}
                disabled={submitted || save.isPending || !enabled || recoveryError}
                onChange={(event) =>
                    updateDraft({ ...draft, displayAuthor: event.target.value as "Persona A" | "Persona B" })
                }
            >
                <option>Persona A</option>
                <option>Persona B</option>
            </select>
            <p className="feedback-hint">
                El nombre es elegido por quien usa el acceso compartido.
            </p>
            {!target && (
                <>
                    <label htmlFor={`${id}-title`}>Título</label>
                    <input
                        id={`${id}-title`}
                        value={draft.title}
                        maxLength={160}
                        required
                        readOnly={submitted}
                        disabled={!enabled || recoveryError}
                        onChange={(event) => updateDraft({ ...draft, title: event.target.value })}
                    />
                </>
            )}
            <label htmlFor={`${id}-body`}>{target ? "Comentario" : "Nota"}</label>
            <textarea
                id={`${id}-body`}
                value={draft.body}
                maxLength={8000}
                rows={4}
                required
                readOnly={submitted}
                disabled={!enabled || recoveryError}
                onChange={(event) => updateDraft({ ...draft, body: event.target.value })}
            />
            <div className="feedback-form-actions">
                <button
                    type="submit"
                    disabled={
                        !enabled ||
                        recoveryError ||
                        save.isPending ||
                        !draft.body.trim() ||
                        (!target && !draft.title.trim())
                    }
                >
                    {save.isPending
                        ? "Guardando…"
                        : submitted
                          ? "Comprobar guardado"
                          : target
                            ? "Agregar comentario"
                            : "Guardar nota"}
                </button>
            </div>
            {submitted && !save.isPending && !message && (
                <p role="status">
                    Este envío espera confirmación. Comprobá el guardado para continuar.
                </p>
            )}
            {message && <p role={save.isError ? "alert" : "status"}>{message}</p>}
        </form>
    );
}
