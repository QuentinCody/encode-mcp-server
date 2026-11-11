import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { encodeFetch } from "./http";
import { fail, readText } from "./response";
import { screen, type ScreenEnv } from "./screen";
import { regulatoryManifest } from "./regulatory";
import { screenBulk } from "./bulk";

const ZERO_HIT_NOTE = "ENCODE answered this search with its documented zero-hit 404 (@graph: [], total: 0). This certifies 0 matches for these filters; it is not an endpoint or accession error.";

/** ENCODE (snovault) answers a valid search with no hits as HTTP 404 plus a well-formed search body. */
function zeroHitSearch(text: string): Record<string, unknown> | undefined {
  let body: unknown;
  try { body = JSON.parse(text); } catch { return undefined; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  return Array.isArray(record["@graph"]) && record["@graph"].length === 0 && record.total === 0 ? record : undefined;
}

export function createEncodeApiFetch(env: ScreenEnv = {}): ApiFetchFn {
  return async request => {
    if (request.method.toUpperCase() !== "GET" || request.body !== undefined) fail("ENCODE operations accept GET without a body", 405);
    const params = request.params ?? {};
    if (request.path.startsWith("/screen/bulk/")) return { status: 200, data: await screenBulk(request.path, params) };
    if (request.path.startsWith("/screen/")) return { status: 200, data: await screen(request.path, params, env) };
    const deadline = Date.now() + 45_000;
    const get = async (path: string, filters?: Record<string, unknown>) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) fail("ENCODE request exceeded 45 seconds", 504);
      const response = await encodeFetch(path, filters, { timeout: Math.min(15_000, remaining), deadlineMs: remaining });
      const text = await readText(response);
      if (!response.ok) {
        const empty = response.status === 404 ? zeroHitSearch(text) : undefined;
        if (empty) return { ...empty, __guard: { verified_empty: true, note: ZERO_HIT_NOTE, probed: path } };
        fail(`ENCODE HTTP ${response.status}`, response.status, { response: text.slice(0, 2000) });
      }
      try { return JSON.parse(text) as unknown; }
      catch { fail("ENCODE returned invalid JSON", 502); }
    };
    if (request.path === "/regulatory/manifest") return { status: 200, data: await regulatoryManifest(params, get) };
    return { status: 200, data: await get(request.path, params) };
  };
}
