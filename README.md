# encode-mcp-server

MCP server wrapping the [ENCODE Project](https://www.encodeproject.org/) portal REST API — functional genomics experiments, biosamples, files, and annotations (cCREs, ChromHMM).

- **Base URL**: `https://www.encodeproject.org`
- **API docs**: https://www.encodeproject.org/help/rest-api/ (profiles at `/profiles/`)
- **Port** (dev): `8883`
- **Auth**: ENCODE portal and SCREEN bulk discovery are public; SCREEN GraphQL queries require host-side `SCREEN_API_KEY`.

All functionality is exposed through Code Mode: `encode_search` (discover endpoints) and `encode_execute` (run JavaScript in a V8 isolate). The HTTP adapter auto-injects `Accept: application/json` and `format=json` so responses are always JSON. Portal-search results are wrapped — records live under `@graph`. Large responses auto-stage to `ENCODE_DATA_DO`; query with `encode_query_data` and inspect schemas via `encode_get_schema`.

All four tools also have `mcp_` aliases. Complete responses above 30KiB use shared staging, with serialization headroom; retain the returned handle when running recipes. SQL and schema responses also retain citations and stage complete envelopes when necessary. Portal and authenticated SCREEN JSON reads are bounded at 2MiB; public bulk configuration reads at 256KiB. Narrow an oversized query instead of assuming a truncated result is complete.

## Regulatory files and SCREEN

The catalog includes cCRE and gene-link file discovery recipes. Adapter-owned `GET /regulatory/manifest` requires an exact `file_accession`, `assembly`, `encyclopedia_version` and transferred-file `expected_md5`. It checks file and parent annotation metadata, rechecks the file for drift, and preserves both complete records. `md5sum` describes transferred bytes; `content_md5sum` describes uncompressed bytes. This helper does **not** download or verify artifact bytes, create a historical portal snapshot, or silently substitute a newer release.

SCREEN [announced its authorized API in June 2026](https://screen.wenglab.org/about/versions). These adapter-owned routes use the [documented GraphQL service](https://console.wenglab.org/docs):

| Route | Result |
| --- | --- |
| `/screen/sources` | Public documentation, download and release-history discovery; no key required |
| `/screen/ccres` | cCRE coordinates/class, maximum signals and nearest genes |
| `/screen/gene-links` | cCRE-to-gene links with experimental/eQTL/contact methods and source context |
| `/screen/linked-ccres` | Reverse links for one human Ensembl gene |
| `/screen/computational-links` | Predictions for explicitly selected methods, retaining method-specific scores |

Queries require explicit `assembly` (`grch38` or `mm10`); documented gene-link operations are human-only. cCRE queries accept 1–10 exact accessions. Computational methods must be selected explicitly. Nearest-gene proximity, experimental links and computational predictions have different meanings; preserve biosample, method and source fields when comparing them.

Provision `SCREEN_API_KEY` as a Worker secret using the provider's [authentication instructions](https://console.wenglab.org/docs/getting-started/auth). Never pass a key in Code Mode arguments. Keys expire after 90 days. No key is currently provisioned, so authenticated live validation is pending; missing configuration returns an explicit error.

SCREEN API results retain the GraphQL envelope, query, retrieval time and response hash. The documented queries provide no historical-release selector or authoritative count/cursor, so `data_release` and `registry_version` remain unknown. An optional `expected_response_sha256` detects response changes; it cannot retrieve historical data. GraphQL partial errors fail explicitly. Site release r3.2026.3 and Registry V4 are separate version dimensions.

The [SCREEN downloads page](https://screen.wenglab.org/downloads) also offers class/assembly files, individual gene-link files and the August 2026 Core Collection class matrix. Two keyless adapter routes support the matrix and eight gene-link artifacts:

| Route | Result |
| --- | --- |
| `/screen/bulk/catalog` | Reviewed download identities plus the complete public configuration text and its SHA-256 |
| `/screen/bulk/manifest` | One selected `source_key`, requiring its `expected_catalog_sha256`, with current HEAD byte size and strong ETag |

The configuration comes from the provider's mutable `SCREEN3.0/staging` source. Changed reviewed URLs or selected configuration hashes fail explicitly. A source branch, site release, Registry version and artifact snapshot are separate: no immutable release or downloaded-byte verification is inferred. HEAD does not retrieve the gzip, and an ETag is not a checksum.

The standard-library [local bulk CLI](scripts/README.md) performs bounded conditional acquisition, SHA-256 verification and SQLite import. It preserves every original decoded line and TSV cell, duplicate row occurrence, method, biosample label and literal value. Import requires explicit column positions selected after inspecting the downloaded file; current native headers have **not** been qualified. Query cCRE/gene matches or matrix columns locally and export the exact original decoded bytes. The CLI does not create a hosted database or expose local SQLite through MCP.

Public files need no SCREEN API key. Authenticated API acceptance remains separate. hg19/hs1 lifted files are not native assembly callsets; only the reviewed GRCh38 artifacts are offered by these bulk routes.

## Validation

Local behavioral tests cover query contracts, credential containment, metadata/checksum drift, partial errors, bounded reads, dual registration and lossless shared staging. Bulk tests exercise stateless JSON-RPC with generated helpers and Node SQLite, plus Python whole-file import/query/export. Run `python3 -m unittest discover -s servers/encode-mcp-server/scripts -p 'test_*.py' -v` for CLI regressions. These use synthetic files, not proof of current native schema, download availability or Workerd compatibility. Native gzip/HEAD qualification, live portal/Worker checks and authenticated SCREEN checks remain pending. See the [bulk review](../../docs/audits/2026-10-05-screen-bulk-review.md).

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from ENCODE / SCREEN and stays under the terms of that source: Open, no restrictions.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
