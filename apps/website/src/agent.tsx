import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import type { AgentRun } from "@repo/client";
import { useSession } from "./auth";
import { Heading } from "./ui";
import { useAgentRuns, useStartAgent, useCancelAgent, useDecideAgent } from "./agent.queries";
import "./agent.css";

const statusText = {
    queued: "En espera",
    running: "Preparando el plan…",
    succeeded: "Propuesta lista",
    failed: "No se pudo completar",
    canceled: "Cancelado",
};
export function AgentPage() {
    const query = useAgentRuns();
    const start = useStartAgent();
    const owner = useSession()?.role === "owner";
    const [room, setRoom] = useState("");
    const [goal, setGoal] = useState("");
    const operation = useRef<{ text: string; id: string } | null>(null);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const text = JSON.stringify({ room: room.trim(), goal: goal.trim() });
        if (operation.current?.text !== text) operation.current = { text, id: crypto.randomUUID() };
        start.mutate(
            { operationId: operation.current.id, room, goal },
            {
                onSuccess: () => {
                    setGoal("");
                    operation.current = null;
                },
            },
        );
    };
    return (
        <div className="agent-page">
            <Heading title="Planificar con un agente" action={<Link to="/notas">Ver notas</Link>} />
            <p>
                Prepará los próximos pasos para un ambiente con las compras que ya registraste.
                Revisá la propuesta antes de guardarla como nota.
            </p>
            {query.isPending && <p role="status">Cargando ejecuciones…</p>}
            {query.isError && (
                <p role="alert">
                    No se pudieron cargar las ejecuciones.{" "}
                    <button onClick={() => void query.refetch()}>Volver a intentar</button>
                </p>
            )}
            {query.data && !query.data.configured && (
                <p className="inline-notice" role="status">
                    El agente todavía no está configurado. Podés consultar las propuestas
                    anteriores.
                </p>
            )}
            {owner ? (
                <form className="agent-form" onSubmit={submit}>
                    <label>
                        Ambiente
                        <input
                            required
                            maxLength={100}
                            value={room}
                            onChange={(event) => setRoom(event.target.value)}
                            placeholder="Por ejemplo, Living"
                        />
                    </label>
                    <label>
                        Qué querés resolver
                        <textarea
                            required
                            minLength={10}
                            maxLength={2000}
                            rows={4}
                            value={goal}
                            onChange={(event) => setGoal(event.target.value)}
                            placeholder="Definir qué preparar primero para la mudanza…"
                        />
                    </label>
                    <p>
                        Al generar, enviás a OpenAI este objetivo y hasta 50 compras de ese
                        ambiente. El agente no busca en la web ni hace compras.
                    </p>
                    <button
                        className="button"
                        disabled={
                            !query.data?.configured ||
                            query.isError ||
                            start.isPending ||
                            goal.trim().length < 10 ||
                            !room.trim()
                        }
                    >
                        {start.isPending ? "Enviando…" : "Generar propuesta"}
                    </button>
                    {start.isError && (
                        <p role="alert">
                            {start.error.message} Revisá las ejecuciones antes de reintentar; se
                            conserva el pedido.
                        </p>
                    )}
                </form>
            ) : (
                <p>Sólo el propietario puede generar, cancelar o guardar propuestas.</p>
            )}
            <section aria-label="Ejecuciones recientes" className="agent-runs">
                <h2>Ejecuciones recientes</h2>
                {query.data && !query.data.runs.length && <p>Todavía no hay ejecuciones.</p>}
                {query.data?.runs.map((run) => (
                    <RunCard key={run.id} run={run} owner={owner} />
                ))}
            </section>
        </div>
    );
}
function RunCard({ run, owner }: { run: AgentRun; owner: boolean }) {
    const cancel = useCancelAgent();
    const decide = useDecideAgent();
    const busy = cancel.isPending || decide.isPending;
    return (
        <article className="agent-run">
            <h3>{run.room}</h3>
            <p>{run.goal}</p>
            <p role="status">
                {statusText[run.status]} · Intentos: {run.attempts}
            </p>
            {run.issue === "access_revoked" && (
                <p>El acceso de quien inició esta ejecución cambió.</p>
            )}
            {run.issue === "provider_failed" && (
                <p>No se pudo obtener una respuesta válida del modelo.</p>
            )}
            {run.issue === "attempts_exhausted" && <p>Se agotaron los intentos de recuperación.</p>}
            {owner && (run.status === "queued" || run.status === "running") && (
                <button className="button" disabled={busy} onClick={() => cancel.mutate(run.id)}>
                    Cancelar ejecución
                </button>
            )}
            {run.proposal && (
                <>
                    <p>{run.proposal.summary}</p>
                    <ol>
                        {run.proposal.steps.map((step, index) => (
                            <li key={index}>
                                <strong>{step.title}</strong>
                                <p>{step.detail}</p>
                                {step.evidenceIds.length > 0 && (
                                    <p>
                                        Referencias del hogar:{" "}
                                        {step.evidenceIds
                                            .map(
                                                (id) =>
                                                    run.sources.find((source) => source.id === id)
                                                        ?.title ?? "Referencia",
                                            )
                                            .join(", ")}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ol>
                    {run.decision === "pending" && owner && (
                        <div className="agent-actions">
                            <button
                                className="button"
                                disabled={busy}
                                onClick={() => decide.mutate({ id: run.id, decision: "applied" })}
                            >
                                Guardar como nota
                            </button>
                            <button
                                className="button"
                                disabled={busy}
                                onClick={() => decide.mutate({ id: run.id, decision: "dismissed" })}
                            >
                                Descartar propuesta
                            </button>
                        </div>
                    )}
                    {run.decision === "applied" && (
                        <p>
                            Guardado como nota.{" "}
                            <Link to="/notas" hash={`nota-${run.noteId}`}>
                                Abrir nota
                            </Link>
                        </p>
                    )}
                    {run.decision === "dismissed" && <p>Propuesta descartada.</p>}
                </>
            )}
            {(cancel.isError || decide.isError) && (
                <p role="alert">{cancel.error?.message ?? decide.error?.message}</p>
            )}
        </article>
    );
}
