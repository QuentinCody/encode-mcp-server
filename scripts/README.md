# Local SCREEN bulk snapshots

`screen_bulk.py` uses Python 3.11+ and its standard library. It handles one reviewed public GRCh38 gzip TSV at a time. No account, API key, package installation or hosted database is required. This local CLI is separate from authenticated SCREEN GraphQL and from MCP's temporary staged data.

## Discover and select

Use `encode_execute` (or its `mcp_` alias) to discover current metadata:

```javascript
return await api.get("/screen/bulk/catalog");
```

Choose an exact artifact key and the returned `source.catalog_sha256`, then call:

```javascript
return await api.get("/screen/bulk/manifest", {
  source_key: "HumanCoreCollectionClassMatrix",
  expected_catalog_sha256: "<hash selected from discovery>"
});
```

Save the complete returned **data object** as `manifest.json`. If staged, recover the entire payload with `encode_query_data`; a preview or MCP envelope is not an import manifest. The catalogue hash covers `source.config_text` encoded as UTF-8, with a leading BOM omitted. Keeping that text prevents JSON key reordering or Python/JavaScript number formatting from changing the pin. The parsed source configuration is also retained and checked.

Only reviewed provider URLs are accepted. Configuration drift requires a new explicit selection. The mutable source branch and artifact URL do not establish an immutable release, and no Registry release is inferred from a filename. The manifest requires a positive HEAD byte size and strong ETag; providers without these validators fail explicitly.

## Acquire, inspect and import

```sh
python3 servers/encode-mcp-server/scripts/screen_bulk.py fetch manifest.json selected.gz
python3 servers/encode-mcp-server/scripts/screen_bulk.py inspect selected.gz
```

`fetch` uses `If-Match`, rejects redirects, partial responses, changed validators, content encoding and size mismatches, and prints the SHA-256 of the transferred gzip bytes. The default compressed budget is 64MiB (`--max-bytes` can select another explicit budget). Socket operations have a 30-second timeout and elapsed time is checked between chunks against 300 seconds; this is not a strict wall-clock cancellation deadline.

`inspect` previews at most five decoded lines/4,096 characters per line and **does not validate the whole file**. Read native headers and determine whether line one is a header and which one-based columns hold cCRE and optional gene identifiers. Do not assume the example positions below match a provider file. Current native gzip headers have not been verified in this environment.

```sh
python3 servers/encode-mcp-server/scripts/screen_bulk.py import \
  manifest.json selected.gz snapshot.sqlite \
  --sha256 '<SHA-256 from the fetch receipt>' \
  --header-row 1 --ccre-column '<observed one-based position>'
```

For gene-link files add `--gene-column '<observed one-based position>'`. Choose `--header-row 0` for a headerless file. This importer expects a consistent TAB-delimited layout with zero or one header line. Multi-line preambles or other native formats require a reviewed adapter; do not discard source lines to make them fit.

Import verifies the complete gzip/CRC, strict UTF-8, every row width and the selected compressed SHA-256 both before processing and before publication. Defaults: 8GiB decoded bytes, 8MiB per line and ten million data rows, adjustable with the corresponding `--max-*` flags. Empty cCRE identifiers, NULs in mapped identifiers and bound violations fail without publishing a partial database. Outputs must be new paths; existing files/symlinks are preserved.

## Query and recover

```sh
python3 servers/encode-mcp-server/scripts/screen_bulk.py query snapshot.sqlite \
  --ccre EH38E1516972 --column-label '<exact biosample header>'
python3 servers/encode-mcp-server/scripts/screen_bulk.py query snapshot.sqlite \
  --gene '<literal native gene identifier>' --limit 100 --offset 0
python3 servers/encode-mcp-server/scripts/screen_bulk.py export snapshot.sqlite original.tsv
```

Queries return original cells, source line/record numbers, raw lines and provenance. Matching is literal and case-sensitive. Both identifier predicates can be combined; pages carry `next_offset`. Use `--column` when labels are absent or repeated. No identifier normalization, score pooling, row deduplication or causal interpretation is performed. Experimental links, eQTL associations, contact evidence and computational predictions retain their native meanings.

The database retains the complete manifest and compressed/decoded hashes. `export` reconstructs every decoded byte, including BOM, CRLF, quotes and the final newline state, and verifies the decoded hash before publication. Query treats the local database as trusted; it does not hash every stored row on each lookup. An empty page says nothing about biological absence or coverage outside the selected file.
