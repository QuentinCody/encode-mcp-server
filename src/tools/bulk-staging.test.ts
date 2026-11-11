/// <reference types="node" />
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { verifyCitationEnvelope } from "@bio-mcp/shared";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { fixture, recover } from "./bulk.test-support";
import { MyMCP } from "../index";
import artifacts from "../lib/bulk-artifacts.json";
import { SCREEN_DOWNLOADS } from "../lib/bulk";
import { bulkWorkflows } from "../spec/bulk";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const size = (data: unknown) => Buffer.byteLength(JSON.stringify(data));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// Exercise the stateless JSON-RPC transport, generated helpers and real SQLite.
// Only upstream fetch and the Cloudflare isolate/storage bindings are substituted.
function wireFixture() {
  const f = fixture();
  const metrics = { calls: 0, maxBytes: 0 };
  for (const [name, tool] of Object.entries(f.tools)) tool.handler = async (args: unknown) => {
    const request = new Request("http://fixture/mcp", { method: "POST", headers: {
      accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": name, "mcp-protocol-version": "2026-07-28",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args,
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "bulk-fixture", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} },
    } }) });
    const response = await MyMCP.serve("/mcp").fetch(request, f.env as never, { waitUntil() {} } as never);
    const wire = await response.text();
    expect(response.status, wire).toBe(200);
    expect(Buffer.byteLength(wire)).toBeLessThan(30720);
    metrics.calls++; metrics.maxBytes = Math.max(metrics.maxBytes, Buffer.byteLength(wire));
    const result = JSON.parse(wire).result;
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { _meta: { citation: { result_hash: expect.any(String) } } } });
    expect(size(result.structuredContent)).toBeLessThan(100000);
    if (!result.structuredContent._staging) {
      const checked = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args });
      expect(checked.verification).toMatchObject({ query: "verified", result: "verified", quarantined: false });
    }
    return result;
  };
  return { ...f, metrics };
}

it("recovers large keyless catalogues and pinned manifests with original source text through both aliases", async () => {
  const f = wireFixture();
  const native = { Downloads: Object.fromEntries(artifacts.map(item => [item.key, SCREEN_DOWNLOADS + item.file])), future: { n: 1e-7, annotation: 'λ"\\'.repeat(12000) } };
  const configText = JSON.stringify(native, null, 2);
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD"
    ? new Response(null, { headers: { "content-length": "1000", etag: '"fixture"' } }) : new Response(configText));
  vi.stubGlobal("fetch", fetcher);
  try {
    for (const prefix of ["", "mcp_"]) {
      for (const code of [bulkWorkflows[0].code, `return await api.get('/screen/bulk/manifest',${JSON.stringify({ source_key: artifacts[0].key, expected_catalog_sha256: sha(configText) })});`]) {
        const result = await f.tools[`${prefix}encode_execute`].handler({ code }, {});
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent.data).toMatchObject({ __staged: true });
        const full = await recover(f, result.structuredContent.data.data_access_id, prefix);
        expect(full.source).toMatchObject({ native, config_text: configText, catalog_sha256: sha(configText) });
        if (code === bulkWorkflows[0].code) expect(full.artifacts).toHaveLength(9);
        else expect(full).toMatchObject({ artifact: { bytes: 1000, etag: '"fixture"', sha256: null }, artifact_bytes_verified: false });
      }
    }
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "HEAD")).toHaveLength(2);
    expect(f.metrics.calls).toBeGreaterThan(100);
  } finally { f.close(); }
}, 30000);

it("stages composed/SQL envelopes and verifies recovered full-result citations", async () => {
  const f = wireFixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = { code: "return {text: 'α'.repeat(20000)};" };
      const output = await f.tools[`${prefix}encode_execute`].handler(args, {});
      expect(output.structuredContent._staging).toBeDefined();
      const id = output.structuredContent.data_access_id;
      const full = await recover(f, id, prefix);
      expect(full.structuredContent.data.text).toBe("α".repeat(20000));
      const checked = await verifyCitationEnvelope({ citation: output.structuredContent._meta.citation, structuredContent: output.structuredContent, toolArguments: args, materialized: { value: full } });
      expect(checked.verification).toMatchObject({ query: "verified", result: "verified", quarantined: false });
      const query = await f.tools[`${prefix}encode_query_data`].handler({ data_access_id: id, sql: "SELECT replace(hex(zeroblob(40000)), '00', 'x') AS value" }, {});
      const stored = await recover(f, query.structuredContent.data_access_id, prefix);
      expect(stored.structuredContent.data.rows[0].value).toBe("x".repeat(40000));
      const schema = await f.tools[`${prefix}encode_get_schema`].handler({ data_access_id: id }, {});
      expect(schema.isError).not.toBe(true);
      const failed = await f.tools[`${prefix}encode_query_data`].handler({ data_access_id: id, sql: "DELETE FROM payloads" }, {});
      expect(failed).toMatchObject({ isError: true, structuredContent: { success: false } });
    }
  } finally { f.close(); }
}, 30000);

it("keeps both fields and error flags on keyless authenticated-API and metadata failures", async () => {
  const f = wireFixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid")));
  try {
    for (const prefix of ["", "mcp_"]) {
      for (const code of ["return await api.get('/screen/bulk/catalog');", "return await api.get('/screen/gene-links',{assembly:'grch38',accessions:['EH38E1516972']});"]) {
        const result = await f.tools[`${prefix}encode_execute`].handler({ code }, {});
        expect(result, JSON.stringify(result)).toMatchObject({ isError: true, structuredContent: { success: false } });
        expect(JSON.stringify(result)).toContain(code.includes("gene-links") ? "SCREEN_API_KEY" : "invalid JSON");
      }
      const search = await f.tools[`${prefix}encode_search`].handler({ query: "SCREEN bulk", max_results: 2 }, {});
      expect(search.isError).not.toBe(true);
      expect(JSON.stringify(search)).toContain("/screen/bulk/");
    }
  } finally { f.close(); }
});

it("reserves SDK serialization bytes at the complete wire boundary", async () => {
  const f = wireFixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      for (const n of [1000, 14000, 29838, 40000]) {
        const output = await f.tools[`${prefix}encode_execute`].handler({ code: `return {text:'x'.repeat(${n})};` }, {});
        expect(output.isError).not.toBe(true);
        if (n >= 29838) expect(output.structuredContent._staging).toBeDefined();
      }
    }
    expect(f.metrics.calls).toBe(8);
  } finally { f.close(); }
});
