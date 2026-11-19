CREATE TABLE households (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE users (id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL);
--> statement-breakpoint
CREATE TABLE memberships (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, role text NOT NULL CONSTRAINT membership_role CHECK (role IN ('owner', 'commenter')));
CREATE INDEX memberships_household_idx ON memberships(household_id);
--> statement-breakpoint
CREATE TABLE rooms (household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, name text NOT NULL, PRIMARY KEY(household_id, name));
--> statement-breakpoint
CREATE TABLE shopping_items (
    household_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL, room text NOT NULL,
    url text NOT NULL, priority text NOT NULL, status text NOT NULL, origin text NOT NULL,
    initial_quantity text NOT NULL, target_quantity text NOT NULL, quality text NOT NULL,
    condition text NOT NULL, notes text NOT NULL, estimated_price_ars numeric(16,2), reference text,
    version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(household_id,id), FOREIGN KEY(household_id,room) REFERENCES rooms(household_id,name) ON DELETE RESTRICT,
    CONSTRAINT shopping_price_nonnegative CHECK (estimated_price_ars IS NULL OR estimated_price_ars >= 0),
    CONSTRAINT shopping_version_nonnegative CHECK (version >= 0)
);
--> statement-breakpoint
CREATE TABLE collection_entries (household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, id text NOT NULL, payload jsonb NOT NULL, imported_at timestamptz NOT NULL, PRIMARY KEY(household_id,id));
CREATE TABLE documents (household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, id uuid NOT NULL, payload jsonb NOT NULL, imported_at timestamptz NOT NULL, PRIMARY KEY(household_id,id));
CREATE TABLE reference_sources (household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE, metadata jsonb NOT NULL);
CREATE TABLE visual_references (household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(household_id,id));
--> statement-breakpoint
CREATE TABLE feedback (
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE, id uuid NOT NULL, operation_id uuid NOT NULL,
    user_id uuid REFERENCES users(id), fingerprint text NOT NULL, kind text NOT NULL, display_author text NOT NULL,
    title text NOT NULL, body text NOT NULL, target_kind text, target_id text, context_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(household_id,id),
    CONSTRAINT feedback_operation UNIQUE(household_id,operation_id),
    CONSTRAINT feedback_kind CHECK (kind IN ('comment','note')),
    CONSTRAINT feedback_author CHECK (display_author IN ('Persona A','Persona B')),
    CONSTRAINT feedback_target CHECK ((kind = 'note' AND target_kind IS NULL AND target_id IS NULL) OR (kind = 'comment' AND target_kind IN ('shopping','collection','document','moodboard','note') AND target_id IS NOT NULL))
);
CREATE INDEX feedback_target_idx ON feedback(household_id,target_kind,target_id);
