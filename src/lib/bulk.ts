import artifacts from "./bulk-artifacts.json";
import { bulkMetadata } from "./bulk-http";
import { fail, object } from "./response";

export const SCREEN_CONFIG = "https://raw.githubusercontent.com/weng-lab/SCREEN3.0/staging/src/common/config.json";
export const SCREEN_DOWNLOADS = "https://downloads.wenglab.org/";
const scope = "One selected public file. Site release, Registry version and file snapshot are distinct. Preserve native class/method/biosample fields; no causal, pooled-score or complete-coverage inference.";

async function catalogue() {
  const { text } = await bulkMetadata(SCREEN_CONFIG, "GET");
  let native: Record<string, unknown>;
  try { native = object(JSON.parse(text)); } catch { fail("SCREEN download configuration is invalid JSON", 502); }
  const downloads = object(native.Downloads);
  for (const item of artifacts) if (downloads[item.key] !== SCREEN_DOWNLOADS + item.file) fail(`SCREEN download reference changed for ${item.key}; review the published source`, 409);
  return {
    artifacts: artifacts.map(item => ({ ...item, url: SCREEN_DOWNLOADS + item.file, assembly: "GRCh38", compression: "gzip", schema: "Inspect downloaded text and supply explicit column mappings; native headers are not assumed." })),
    source: { url: SCREEN_CONFIG, retrieved_at: new Date().toISOString(), catalog_sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join(""), hash_scope: "UTF-8 of config_text; a leading UTF-8 BOM is omitted", config_text: text, native },
    scope, data_release: null, registry_version: null,
  };
}

export async function screenBulk(path: string, params: Record<string, unknown>) {
  if (!["/screen/bulk/catalog", "/screen/bulk/manifest"].includes(path)) fail("Unknown SCREEN bulk operation", 404);
  const manifest = path.endsWith("/manifest");
  const allowed = manifest ? ["source_key", "expected_catalog_sha256"] : [];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) fail(`Unsupported bulk parameter: ${key}`);
  const selected = artifacts.find(item => item.key === params.source_key);
  if (manifest && (!selected || typeof params.expected_catalog_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(params.expected_catalog_sha256))) fail("Select a published source_key and its exact expected_catalog_sha256");
  const data = await catalogue();
  if (!manifest) return data;
  if (data.source.catalog_sha256 !== String(params.expected_catalog_sha256).toLowerCase()) fail("SCREEN download catalogue changed; inspect and select again", 409);
  const artifact = data.artifacts.find(item => item.key === selected!.key)!;
  const { response } = await bulkMetadata(artifact.url, "HEAD");
  const length = response.headers.get("content-length");
  const bytes = length && /^\d+$/.test(length) ? Number(length) : Number.NaN;
  const etag = response.headers.get("etag");
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || !etag || !/^"[^"\r\n]+"$/.test(etag)) fail("SCREEN artifact requires a byte size and strong ETag for pinned acquisition", 502);
  return {
    format_version: "screen-bulk-manifest-1", source: data.source,
    artifact: { ...artifact, bytes, etag, last_modified: response.headers.get("last-modified"), content_type: response.headers.get("content-type"), sha256: null },
    assembly: "GRCh38", data_release: null, registry_version: null, scope,
    artifact_bytes_verified: false,
    checksum_note: "ETag is a validator, not a checksum. Local acquisition verifies size/ETag and computes SHA-256; import requires that exact SHA-256. No gzip bytes have been retrieved by this operation.",
    import: { command: "python3 servers/encode-mcp-server/scripts/screen_bulk.py --help", location: "local SQLite; no hosted backend", column_mapping: "Explicit one-based positions selected after inspect; preserve every native cell and row occurrence." },
  };
}
