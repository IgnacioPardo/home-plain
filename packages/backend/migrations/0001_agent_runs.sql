CREATE TABLE agent_runs (
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    id uuid NOT NULL, operation_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
    fingerprint text NOT NULL, context jsonb NOT NULL,
    status text NOT NULL DEFAULT 'queued', progress text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_expires_at timestamptz,
    proposal jsonb, decision text NOT NULL DEFAULT 'pending', note_id uuid, issue text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(household_id,id), CONSTRAINT agent_operation UNIQUE(household_id,operation_id),
    CONSTRAINT agent_status CHECK (status IN ('queued','running','succeeded','failed','canceled')),
    CONSTRAINT agent_progress CHECK (progress IN ('queued','planning','review','failed','canceled')),
    CONSTRAINT agent_decision CHECK (decision IN ('pending','applied','dismissed')),
    CONSTRAINT agent_attempts CHECK (attempts BETWEEN 0 AND 3),
    CONSTRAINT agent_lease CHECK ((status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX agent_claim_idx ON agent_runs(status,created_at);

CREATE INDEX agent_household_created_idx ON agent_runs(household_id,created_at);
--> statement-breakpoint
ALTER TABLE feedback DROP CONSTRAINT feedback_author;
ALTER TABLE feedback ADD CONSTRAINT feedback_author CHECK (display_author IN ('Persona A','Persona B','Agente'));
