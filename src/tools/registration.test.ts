import { expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { createEncodeApiFetch } from "../lib/api-adapter";
import { encodeCatalog } from "../spec/catalog";

it("registers dual aliases and discovers release-pinned regulatory workflows", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  for (const name of ["encode_search", "encode_execute", "encode_query_data", "encode_get_schema"]) {
    expect(tools[name]).toBeDefined(); expect(tools[`mcp_${name}`]).toBeDefined();
  }
  const result = await tools.mcp_encode_search.handler({ query: "Pin a selected ENCODE cCRE artifact", category: "workflows", max_results: 5 }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
  expect(JSON.stringify(result)).toContain("expected_md5");
  expect(await tools.mcp_encode_query_data.handler({ data_access_id: "encode_fixture", sql: "SELECT 1" }, {})).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: expect.any(Object) });
  expect(encodeCatalog.endpointCount).toBe(encodeCatalog.endpoints.length);
});
it("preserves complete SCREEN evidence context and provenance when staging above 30KiB", async () => {
  const raw = { data: { linkedGenesQuery: [{ accession: "EH38E1516972", geneid: "ENSG00000124766", method: "CRISPR", p_val: 0, effectsize: -1.2, source: "α".repeat(17_000) }] } };
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(raw)));
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      stored.push((await request.json() as { data: unknown }).data);
      return json({ success: true, tables_created: ["links"], total_rows: 1, input_rows: 1, table_row_counts: { links: 1 } });
    }
    return json({ success: true, schema: { tables: { links: { columns: [{ name: "accession" }] } } } });
  } }) } as unknown as DurableObjectNamespace;
  try {
    const proxy = createApiProxyTool({ apiFetch: createEncodeApiFetch({ SCREEN_API_KEY: "screen_fixture_secret" }), catalog: encodeCatalog, doNamespace: namespace, stagingPrefix: "encode", maxInlineBytes: 30 * 1024 });
    const result = await proxy.handler({ method: "GET", path: "/screen/gene-links", params: { assembly: "grch38", accessions: ["EH38E1516972"] } }, { sql: () => [] });
    expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String) });
    expect(JSON.parse(stored[0] as string)).toMatchObject({ ...raw, _screen: { data_release: null, assembly: "grch38", response_sha256: expect.any(String) } });
    expect(stored[1]).toMatchObject({ ...raw, _screen: { data_release: null } });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30_000);
  } finally { vi.unstubAllGlobals(); }
});
it.each([{ __api_error: true, status: 409 }, { __staged: true, data_access_id: "encode_fixture" }, { __stage_error: true, message: "staging unavailable" }])("recipes preserve error and staging handles %#", async handle => {
  for (const workflow of encodeCatalog.workflows!) {
    const run = new Function("api", `return (async () => { ${workflow.code} })()`);
    expect(await run({ get: vi.fn().mockResolvedValue(handle) })).toEqual(handle);
  }
});
it("keyless SCREEN errors survive canonical proxy handling", async () => {
  const proxy = createApiProxyTool({ apiFetch: createEncodeApiFetch(), catalog: encodeCatalog, stagingPrefix: "encode", maxInlineBytes: 30 * 1024 });
  expect(await proxy.handler({ method: "GET", path: "/screen/gene-links", params: { assembly: "grch38", accessions: ["EH38E1516972"] } }, { sql: () => [] })).toMatchObject({ __api_error: true, status: 503, incomplete: true });
});
