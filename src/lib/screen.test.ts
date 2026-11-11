import { afterEach, expect, it, vi } from "vitest";
import { screen, screenQuery } from "./screen";
import { createEncodeApiFetch } from "./api-adapter";
const token = "screen_fixture_01234567890123456789";
const params = { assembly: "grch38", accessions: ["EH38E1516972"] };
const row = { accession: "EH38E1516972", gene: "GENE", geneid: "ENSG00000124766", method: "CRISPR", assay: "CRISPR", celltype: "K562", p_val: 0, effectsize: -1.2, score: null, source: "fixture", experiment_accession: "ENCSR000AAA", grnaid: "guide1", variantid: null, slope: null, tissue: "blood", displayname: "K562" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("uses only the documented fixed endpoint and host bearer token, retaining evidence context", async () => {
  const payload = { data: { linkedGenesQuery: [row] }, extensions: { source: "fixture" } };
  const fetch = vi.fn().mockResolvedValue(json(payload)); vi.stubGlobal("fetch", fetch);
  const result = await screen("/screen/gene-links", params, { SCREEN_API_KEY: token });
  expect(result).toMatchObject({ ...payload, _screen: { assembly: "grch38", data_release: null, registry_version: null, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  expect(fetch.mock.calls[0][0]).toBe("https://screen.api.wenglab.org/graphql");
  const init = fetch.mock.calls[0][1];
  expect(init).toMatchObject({ method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${token}` } });
  expect(JSON.parse(init.body).query).toContain("p_val gene geneid genetype method grnaid effectsize");
  expect(JSON.stringify(result)).not.toContain(token);
});
it("fails explicitly without a key and makes no anonymous request", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(screen("/screen/gene-links", params, {})).rejects.toMatchObject({ status: 503 });
  expect(fetch).not.toHaveBeenCalled();
});
it("public source discovery needs no key and does not invent data-release selection", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await screen("/screen/sources", {}, {})).toMatchObject({ api: "https://screen.api.wenglab.org/graphql", version_note: expect.stringContaining("not a registry") });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  ["/screen/gene-links", { ...params, assembly: "mm10" }],
  ["/screen/ccres", { ...params, assembly: "hg38" }],
  ["/screen/ccres", { ...params, accessions: ["EM10E123"] }],
  ["/screen/ccres", { ...params, accessions: Array(11).fill("EH38E1") }],
  ["/screen/ccres", { ...params, accessions: [] }],
  ["/screen/ccres", { ...params, accessions: ['EH38E1\") { mutation }'] }],
  ["/screen/ccres", { ...params, api_key: token }],
  ["/screen/ccres", { ...params, release: "v4" }],
  ["/screen/ccres", { ...params, expected_response_sha256: "bad" }],
  ["/screen/linked-ccres", { assembly: "grch38", gene_ids: ["ENSG00000124766.1"] }],
  ["/screen/linked-ccres", { assembly: "grch38", gene_ids: ["ENSG00000124766", "ENSG00000124767"] }],
  ["/screen/computational-links", { ...params, methods: ["unknown"] }],
] as const)("rejects unsupported or ambiguous SCREEN input %#", (path, parameters) => {
  expect(() => screenQuery(path, parameters)).toThrow();
});
it("keeps proximity, observed links, reverse links and computational predictions distinct", () => {
  expect(screenQuery("/screen/ccres", params).query).toContain("nearestgenes { distance gene }");
  expect(screenQuery("/screen/ccres", { assembly: "mm10", accessions: ["EM10E123"] }).query).toContain('assembly: "mm10"');
  expect(screenQuery("/screen/linked-ccres", { assembly: "grch38", gene_ids: ["ENSG00000124766"] }).root).toBe("linkedcCREsQuery");
  const predicted = screenQuery("/screen/computational-links", { ...params, methods: ["ABC_(full)"] });
  expect(predicted.query).toContain('method: ["ABC_(full)"]');
  expect(predicted.query).toContain("methodregion fileaccession");
  expect(predicted.query).not.toContain("assembly:");
});
it("rejects partial GraphQL success and preserves a bounded error explanation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { linkedGenesQuery: [row] }, errors: [{ message: "one source failed" }] })));
  await expect(screen("/screen/gene-links", params, { SCREEN_API_KEY: token })).rejects.toMatchObject({ status: 502, data: { partial_data_present: true, graphql_errors: expect.stringContaining("one source failed") } });
});
it.each([token, encodeURIComponent(token), token.split("").map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")])("withholds credential echoes, including JSON escapes %#", async echo => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"data":{"linkedGenesQuery":[]},"echo":"${echo}"}`)));
  const error = await screen("/screen/gene-links", params, { SCREEN_API_KEY: token }).catch(error => error);
  expect(error).toMatchObject({ status: 502 });
  expect(String(error)).not.toContain(token);
});
it("withholds upstream transport and authorization details containing secrets", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error(`request failed: ${token}`)).mockResolvedValueOnce(new Response(token, { status: 401 })));
  for (let i = 0; i < 2; i++) {
    const error = await screen("/screen/gene-links", params, { SCREEN_API_KEY: token }).catch(error => error);
    expect(String(error)).not.toContain(token);
  }
});
it.each([{ data: { linkedGenesQuery: null } }, { data: { linkedGenesQuery: [{ ...row, accession: "EH38E999" }] } }, { errors: "failed", data: {} }, { data: null }])("rejects missing/mismatched result contracts %#", async payload => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(payload)));
  await expect(screen("/screen/gene-links", params, { SCREEN_API_KEY: token })).rejects.toMatchObject({ status: 502 });
});
it("does not silently merge unrequested prediction methods", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { ComputationalGeneLinksQuery: [{ accession: "EH38E1516972", method: "ABC_(full)" }] } })));
  await expect(screen("/screen/computational-links", { ...params, methods: ["rE2G_(extended)"] }, { SCREEN_API_KEY: token })).rejects.toMatchObject({ status: 502 });
});
it("retains empty provider results without claiming no regulation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { linkedGenesQuery: [] } })));
  expect(await screen("/screen/gene-links", params, { SCREEN_API_KEY: token })).toMatchObject({ data: { linkedGenesQuery: [] }, _screen: { completeness: expect.stringContaining("not proof") } });
});
it("detects response-hash drift without presenting it as historical retrieval", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { linkedGenesQuery: [] } })));
  await expect(screen("/screen/gene-links", { ...params, expected_response_sha256: "0".repeat(64) }, { SCREEN_API_KEY: token })).rejects.toMatchObject({ status: 409 });
});
it("never sends the SCREEN token to the public ENCODE portal", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ accession: "ENCFF000AAA" })); vi.stubGlobal("fetch", fetch);
  await createEncodeApiFetch({ SCREEN_API_KEY: token })({ method: "GET", path: "/files/ENCFF000AAA/" });
  expect(fetch.mock.calls[0][0]).toContain("https://www.encodeproject.org/");
  expect(JSON.stringify(fetch.mock.calls)).not.toContain(token);
});
it("rejects oversized successful SCREEN payloads rather than truncate evidence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { linkedGenesQuery: [row] }, context: "α".repeat(1_100_000) })));
  await expect(screen("/screen/gene-links", params, { SCREEN_API_KEY: token })).rejects.toMatchObject({ status: 502 });
});
