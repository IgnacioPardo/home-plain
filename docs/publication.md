# Publication notes

This standalone repository starts with new history and generic commit identity. Its initial export includes application source, build configuration, tests and synthetic examples. It excludes earlier repository history, personal documentation, imported records, photos, screenshots, credentials, deployment configuration and service wiring.

Default workspace identifiers and fixtures use synthetic UUIDs. Feedback and account labels are generic. The application has no personal domain, conversation URL or predefined workspace link. Explicit imports obtain source metadata from a private validated bundle. Automated checks run on hosted GitHub runners and never deploy.

Before changing visibility, run `pnpm privacy:check` and `pnpm ready`, inspect the commit history and review any added media. Keep private runtime records in PostgreSQL, imports/media in ignored `data/` and secrets in ignored `.env` or the host secret store. Ignore rules do not remove a file already committed; removing sensitive history requires a separate review, and leaked credentials must be rotated.

Future issues, PR descriptions, screenshots, releases, Actions logs and Git author metadata can also become visible with a public repository. Keep those surfaces generic too. Public visibility and an open-source license are separate decisions; the repository preserves upstream attribution without asserting a new license grant.
