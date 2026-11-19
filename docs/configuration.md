# Configuration

For an empty installation, copy `.env.example` to `.env`, generate two separate password hashes with the command documented there, and put each hash in single quotes. For the synthetic demo, use `pnpm demo:setup` instead.

## Notion

Set `NOTION_API_TOKEN`, `NOTION_HOME_PAGE_ID` and `NOTION_SHOPPING_DATA_SOURCE_ID` in ignored `.env`. The supplied all-zero-prefix IDs are synthetic; startup refuses to enable synchronization with them. Use your own workspace IDs. Give the integration access only to the chosen pages and data sources. A CLI login is separate from the server integration token.

The shopping adapter expects these Spanish properties: `Nombre` (title), `Ambiente`, `Prioridad`, `Estado`, `Origen`, `Cantidad inicial`, `Cantidad objetivo`, `Calidad mínima`, `Condición de compra`, `Notas`, `Precio estimado ARS` and `Referencia`. Check `packages/backend/src/notion/notion.client.ts` for their exact types before connecting a source. Read permission enables sync; update permission is needed to change `Estado` between `Comprado` and `En lista`. Missing prices remain null. Need classifications such as `Confirmado`, `Propuesto` and `Condicionado` are separate from purchase completion.

Optional `NOTION_FEEDBACK_DATA_SOURCE_ID` enables comments and notes when its schema and integration write capabilities are configured. Feedback author options are `Persona A` and `Persona B`; they do not confer privileges. See `packages/backend/src/feedback/feedback.client.ts` for the required properties. `NOTION_PRODUCT_REFERENCES_DATA_SOURCE_ID` identifies an optional product-reference source.

The header's Notion link opens Notion generally. Item and document links come from imported records. There are no embedded personal workspace destinations in the frontend.

## Local imports

The `HOME_COLLECTION_FILE`, `HOME_CONTENT_FILE`, `HOME_MOODBOARD_FILE` and `HOME_MEDIA_DIRECTORY` settings default to ignored `data/` paths. Collection and moodboard imports preserve source attribution and expose local authenticated media routes. Keep temporary signed download URLs out of the browser and version control.

The optional scripts in `scripts/` print usage when run without arguments. Run them through the API workspace's `node --import=tsx --conditions=@repo/source` command. Catalog import uses the official `ntn` CLI and a private JSON configuration conforming to `catalogImportConfigSchema`. Its `my-gear` provenance value denotes an inventory source and does not contain inventory data.

Atlas JSON must include `source: { "url": "https://example.com/atlas", "conversation": null }` along with the fields defined in `atlasExportSchema`. Replace that illustrative URL with your own source. The importer validates source metadata and never inserts a predefined conversation link. Pinterest imports extend an existing atlas snapshot. Images and exports must remain under ignored `data/`; publish only material you intend to share and have rights to redistribute.

## Hosting

`Dockerfile` and `docker-compose.yml` provide an optional single-container build with a private data volume. The Compose project and volume are named for Home Plain to keep them separate from other installations. Set a real HTTPS `APP_ORIGIN` and your own account hashes before hosting; the default localhost development origin is not valid in production. Keep the exposed host port on loopback and configure your own HTTPS reverse proxy.

No tunnel credentials, DNS configuration, self-hosted runners or deployment automation are supplied. Existing local services are not modified. Sessions live in one API process and expire on restart; multiple replicas require a shared session/projection strategy.
