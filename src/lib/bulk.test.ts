import { afterEach, expect, it, vi } from "vitest";
import artifacts from "./bulk-artifacts.json";
import { screenBulk, SCREEN_CONFIG, SCREEN_DOWNLOADS } from "./bulk";
import { createEncodeApiFetch } from "./api-adapter";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const native = () => ({ future: { title: "λ", n: 1e-7 }, Downloads: Object.fromEntries(artifacts.map(item => [item.key, SCREEN_DOWNLOADS + item.file])) });
function provider(config = native(), headers: Record<string, string> = { "content-length": "1234", etag: '"snapshot"' }) {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD" ? new Response(null, { headers }) : Response.json(config));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function selected() {
  const catalog = await screenBulk("/screen/bulk/catalog", {});
  return { source_key: artifacts[0].key, expected_catalog_sha256: catalog.source.catalog_sha256 };
}
it("discovers every reviewed key without credentials and preserves the complete source text", async () => {
  const fetcher = provider();
  const { data } = await createEncodeApiFetch()({ method: "GET", path: "/screen/bulk/catalog" });
  expect(data).toMatchObject({ artifacts: expect.any(Array), source: { native: native(), config_text: JSON.stringify(native()), catalog_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, registry_version: null, data_release: null });
  expect((data as { artifacts: unknown[] }).artifacts).toHaveLength(9);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(SCREEN_CONFIG, expect.objectContaining({ method: "GET", redirect: "manual", headers: { Accept: "application/json", "Accept-Encoding": "identity" } }));
});
it("pins HEAD metadata and leaves file-byte validation explicitly pending", async () => {
  const fetcher = provider();
  const params = await selected();
  const result = await screenBulk("/screen/bulk/manifest", params);
  expect(result).toMatchObject({ format_version: "screen-bulk-manifest-1", artifact: { key: artifacts[0].key, bytes: 1234, etag: '"snapshot"', sha256: null }, artifact_bytes_verified: false });
  expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([[SCREEN_CONFIG, "GET"], [SCREEN_CONFIG, "GET"], [SCREEN_DOWNLOADS + artifacts[0].file, "HEAD"]]);
});
it.each([
  ["/screen/bulk/other", {}], ["/screen/bulk/catalog", { unknown: 1 }],
  ["/screen/bulk/manifest", {}], ["/screen/bulk/manifest", { source_key: "https://example.org", expected_catalog_sha256: "a".repeat(64) }],
  ["/screen/bulk/manifest", { source_key: artifacts[0].key, expected_catalog_sha256: "bad" }],
])("rejects unknown routes/parameters before upstream access: %s %j", async (path, params) => {
  const fetcher = provider(); await expect(screenBulk(path as string, params as Record<string, unknown>)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([{ method: "POST" }, { method: "GET", body: {} }])("rejects unsupported transport before access %j", async request => {
  const fetcher = provider(); await expect(createEncodeApiFetch()({ ...request, path: "/screen/bulk/catalog" })).rejects.toMatchObject({ status: 405 }); expect(fetcher).not.toHaveBeenCalled();
});
it("rejects changed catalogue pins before accessing the artifact", async () => {
  const fetcher = provider(); const params = await selected();
  fetcher.mockImplementation(async () => Response.json({ ...native(), newField: true }));
  await expect(screenBulk("/screen/bulk/manifest", params)).rejects.toMatchObject({ status: 409 });
  expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});
it.each([undefined, "https://evil.example/file.gz", SCREEN_DOWNLOADS + "new-release.gz"])("rejects missing/substituted download identity %s", async url => {
  const config = native(); config.Downloads[artifacts[0].key] = url as string; provider(config);
  await expect(screenBulk("/screen/bulk/catalog", {})).rejects.toMatchObject({ status: 409 });
});
it.each([
  { etag: 'W/"weak"', "content-length": "1234" }, { etag: '"snapshot"', "content-length": "0" },
  { etag: '"snapshot"', "content-length": "9007199254740992" }, { etag: '"snapshot"', "content-length": "1.2" },
  { etag: '"snapshot"' }, { "content-length": "1234" },
])("rejects unpinnable HEAD metadata %j", async headers => {
  provider(native(), headers as Record<string, string>);
  await expect(screenBulk("/screen/bulk/manifest", await selected())).rejects.toMatchObject({ status: 502 });
});
it.each(["[]", "{", "null", '{"Downloads":[]}'])("rejects invalid source configuration %s", async text => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
  await expect(screenBulk("/screen/bulk/catalog", {})).rejects.toMatchObject({ status: 502 });
});
