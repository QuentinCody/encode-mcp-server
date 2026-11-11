import { fail, hash, object, readText } from "./response";
export interface ScreenEnv { SCREEN_API_KEY?: string }
const ENDPOINT = "https://screen.api.wenglab.org/graphql";
const details = "accession chromosome start stop ccre_group atac_max_zscore ctcf_max_zscore dnase_max_zscore h3k27ac_max_zscore h3k4me3_max_zscore";
const links = "accession p_val gene geneid genetype method grnaid effectsize assay celltype experiment_accession tissue variantid source slope score displayname";
const computational = "genename accession geneid genetype method celltype score methodregion fileaccession";
const methods = ["ABC_(DNase_only)", "ABC_(full)", "EPIraction", "GraphRegLR", "rE2G_(DNase_only)", "rE2G_(extended)"];
const paths = ["/screen/ccres", "/screen/gene-links", "/screen/linked-ccres", "/screen/computational-links"];

function list(value: unknown, name: string, pattern: RegExp, max: number): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max || value.some(id => typeof id !== "string" || !pattern.test(id))) fail(`${name} must contain 1–${max} valid identifiers`);
  return value as string[];
}
export function screenQuery(path: string, params: Record<string, unknown>) {
  if (!paths.includes(path)) fail("Unknown SCREEN operation", 404);
  const allowed = new Set(["assembly", "expected_response_sha256", ...(path === "/screen/linked-ccres" ? ["gene_ids"] : ["accessions"]), ...(path === "/screen/computational-links" ? ["methods"] : [])]);
  for (const key of Object.keys(params)) if (!allowed.has(key)) fail(`Unsupported SCREEN parameter: ${key}`);
  if (params.assembly !== "grch38" && params.assembly !== "mm10") fail("SCREEN assembly must explicitly be grch38 or mm10");
  if (path !== "/screen/ccres" && params.assembly !== "grch38") fail("Documented SCREEN gene-link queries are human-only; use grch38");
  if (params.expected_response_sha256 !== undefined && (typeof params.expected_response_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(params.expected_response_sha256))) fail("expected_response_sha256 must be 64 hex characters");
  const ids = path === "/screen/linked-ccres"
    ? list(params.gene_ids, "gene_ids", /^ENSG\d{11}$/, 1)
    : list(params.accessions, "accessions", params.assembly === "grch38" ? /^EH38E\d+$/ : /^EM10E\d+$/, 10);
  const assembly = JSON.stringify(params.assembly);
  const values = JSON.stringify(ids);
  let root: string;
  let selection: string;
  let args: string;
  if (path === "/screen/ccres") {
    root = "getmaxZScoresQuery"; selection = `${details} nearestgenes { distance gene }`;
    args = `assembly: ${assembly}, accession: ${values}`;
  } else if (path === "/screen/computational-links") {
    const selected = list(params.methods, "methods", /^[A-Za-z0-9_()-]+$/, 6);
    if (selected.some(method => !methods.includes(method))) fail("Select a documented computational-link method");
    root = "ComputationalGeneLinksQuery"; selection = computational;
    args = `accession: ${values}, method: ${JSON.stringify(selected)}`;
  } else {
    root = path === "/screen/linked-ccres" ? "linkedcCREsQuery" : "linkedGenesQuery";
    selection = links;
    args = `assembly: ${assembly}, ${path === "/screen/linked-ccres" ? "geneid" : "accession"}: ${values}`;
  }
  // Identifiers are validated and JSON-escaped; only fixed read queries are emitted.
  return { root, ids, query: `query { ${root}(${args}) { ${selection} } }` };
}

export function screenSources() {
  return {
    reviewed_at: "2026-09-28", documentation: "https://console.wenglab.org/docs", api: ENDPOINT,
    downloads: "https://screen.wenglab.org/downloads", release_history: "https://screen.wenglab.org/about/versions",
    authentication: "Host-side SCREEN_API_KEY bearer token; provider keys expire after 90 days. Never supply a key in Code Mode inputs.",
    version_note: "Site r3.2026.3 was announced 2026-08-21. A site release is not a registry, genome assembly or immutable data snapshot. API docs do not establish historical release selection.",
    bulk_note: "SCREEN publishes Registry-V4 class and assembly downloads, gene-link files, and the August 2026 Core Collection class matrix. Select an exact published artifact and retain its checksum. hg19/hs1 downloads are lifted from GRCh38; do not treat them as native assembly callsets.",
    interpretation: "Nearest genes describe proximity. CRISPR, eQTL and chromatin-contact links have distinct evidence and biosample contexts; computational scores are method-specific predictions. No causal or universal activity claim is implied.",
  };
}

export async function screen(path: string, params: Record<string, unknown>, env: ScreenEnv) {
  if (path === "/screen/sources") {
    if (Object.keys(params).length) fail("/screen/sources has no parameters");
    return screenSources();
  }
  const request = screenQuery(path, params);
  const token = env.SCREEN_API_KEY;
  if (!token) fail("SCREEN_API_KEY is not configured. Provision a key from https://console.wenglab.org; anonymous programmatic access is not supported.", 503);
  if (token.length > 8192 || /\s/.test(token)) fail("SCREEN_API_KEY configuration is invalid", 503);
  let payload: Record<string, unknown> = await readScreenPayload(token, request);
  const data = object(payload.data);
  if (!Array.isArray(data[request.root])) fail("SCREEN response lacks the requested result array", 502);
  const rows = data[request.root] as unknown[];
  for (const value of rows) {
    const row = object(value);
    const id = path === "/screen/linked-ccres" ? row.geneid : row.accession;
    if (typeof id !== "string" || !request.ids.includes(id)) fail("SCREEN returned evidence for an unrequested identifier", 502);
    if (path === "/screen/computational-links" && !(params.methods as string[]).includes(String(row.method))) fail("SCREEN returned an unrequested prediction method", 502);
  }
  const digest = await hash(payload);
  if (params.expected_response_sha256 && String(params.expected_response_sha256).toLowerCase() !== digest) fail("SCREEN response differs from expected_response_sha256", 409);
  return { ...payload, _screen: {
    source_url: ENDPOINT, retrieved_at: new Date().toISOString(), assembly: params.assembly,
    query: request.query, response_sha256: digest, hash_scope: "JSON.stringify of the complete GraphQL envelope before local metadata",
    data_release: null, registry_version: null,
    release_note: "The documented query does not identify a data release. This is a current API observation; a response hash detects change but does not retrieve historical data. Use pinned bulk/portal files for release-dependent analysis.",
    interpretation: screenSources().interpretation,
    completeness: "One bounded provider response; no documented count/cursor is available for these queries. No local truncation. Absence of links is not proof of no regulation.",
  } };
}

async function readScreenPayload(token: string, request: { root: string; ids: string[]; query: string; }) {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: request.query }),
    });
  } catch { fail("SCREEN request failed or timed out", 502); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail(`SCREEN HTTP ${response.status}; no successful data returned`, response.status);
  }
  let text: string;
  try { text = await readText(response); }
  catch { fail("SCREEN body unavailable, oversized or invalid; narrow the query", 502); }
  for (const secret of [token, JSON.stringify(token).slice(1, -1), encodeURIComponent(token)]) {
    if (text.includes(secret)) fail("SCREEN response contained credential material; response withheld", 502);
  }
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(text)); }
  catch { fail("SCREEN returned invalid GraphQL JSON", 502); }
  if (JSON.stringify(payload).includes(token) || JSON.stringify(payload).includes(JSON.stringify(token).slice(1, -1))) fail("SCREEN response contained credential material; response withheld", 502);
  if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length)) {
    fail("SCREEN GraphQL query failed; partial data is not a complete evidence result", 502, {
      graphql_errors: JSON.stringify(payload.errors).slice(0, 4000), partial_data_present: payload.data != null,
    });
  }
  return payload;
}
