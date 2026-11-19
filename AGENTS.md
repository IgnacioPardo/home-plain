# Home Plain

A reusable home-planning application. Use only synthetic examples in Git.

- Read README.md and docs/architecture.md before changing behavior.
- Create a focused codex/ branch and PR. Use Conventional Commits.
- Run pnpm privacy:check and pnpm ready before delivery. Obtain an independent agent review of the final head and wait for green CI before merge. Never bypass branch rules.
- Keep .env files, tokens, passwords, personal records, media imports and local paths out of source, history, examples, screenshots, logs and PR text.
- Store runtime data under ignored data/. Keep credentials server-side and require authentication for private APIs and media.
- Read .agents/skills/packages/SKILL.md before changing manifests, build configs or entrypoints.
- Domain code belongs in packages/backend; transport and environment configuration belong in apps/api. Browser requests belong in domain query hooks. Keep Zod validation at boundaries.
- Read application environment only in apps/api/src/env.ts. Backend relative imports include .ts; browser imports omit extensions. Use named exports except build configuration.
- Preserve direct Spanish copy, keyboard access, mobile usability and honest loading/error/unconfigured states.
- Personalization and deployment require deliberate configuration. No automatic external publishing or writes to personal records.
