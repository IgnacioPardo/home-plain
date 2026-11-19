import { FeedbackNotes } from "./feedback";
import { useState } from "react";
import type { CollectionEntry } from "@repo/client";
import { useCollection } from "./home.queries";
import { CollectionCard, CollectionDetail } from "./collection";
import { Heading } from "./ui";
import { Documents } from "./documents";
import { useContextLink } from "./context-link";

export function NotesPage() {
    const collection = useCollection();
    const [selected, setSelected] = useState<CollectionEntry | null>(null);
    const notes = collection.data?.entries.filter((entry) => entry.kind === "note") ?? [];
    useContextLink("objeto", notes, setSelected);
    return (
        <>
            <Heading title="Notas" />
            <FeedbackNotes />
            {notes.length > 0 && (
                <div className="notes-grid">
                    {notes.map((entry) => (
                        <CollectionCard
                            key={entry.id}
                            entry={entry}
                            onOpen={() => setSelected(entry)}
                        />
                    ))}
                </div>
            )}
            <div className="section-heading document-section-heading">
                <h2>Documentos y referencias</h2>
            </div>
            <Documents />
            {selected && <CollectionDetail entry={selected} onClose={() => setSelected(null)} />}
        </>
    );
}
export function SourcesPage() {
    return (
        <>
            <Heading title="Fuentes" />
            <div className="source-intro">
                <p>
                    Home guarda tus compras y comentarios. El catálogo muestra los objetos
                    importados, con sus imágenes, fecha y fuente. Las referencias visuales conservan
                    su fuente y fecha de importación.
                </p>
            </div>
            <Documents />
        </>
    );
}
