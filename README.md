# encode-mcp-server

MCP server wrapping the [ENCODE Project](https://www.encodeproject.org/) portal REST API — functional genomics experiments, biosamples, files, and annotations (cCREs, ChromHMM).

- **Base URL**: `https://www.encodeproject.org`
- **API docs**: https://www.encodeproject.org/help/rest-api/ (profiles at `/profiles/`)
- **Port** (dev): `8883`
- **Auth**: none (public)

All functionality is exposed through Code Mode: `encode_search` (discover endpoints) and `encode_execute` (run JavaScript in a V8 isolate). The HTTP adapter auto-injects `Accept: application/json` and `format=json` so responses are always JSON. Portal-search results are wrapped — records live under `@graph`. Large responses auto-stage to `ENCODE_DATA_DO`; query with `encode_query_data` and inspect schemas via `encode_get_schema`.
