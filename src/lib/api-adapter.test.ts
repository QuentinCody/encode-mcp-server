import { beforeEach, expect, it, vi } from "vitest";
import { createEncodeApiFetch } from "./api-adapter";
import { encodeFetch } from "./http";

vi.mock("./http", () => ({ encodeFetch: vi.fn() }));

const fetchMock = vi.mocked(encodeFetch);
const call = (path: string, params: Record<string, unknown> = {}) => createEncodeApiFetch()({ method: "GET", path, params });
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

beforeEach(() => fetchMock.mockReset());

it("returns ENCODE's zero-hit 404 search as a certified empty result, not an error", async () => {
  // A large facets block pushes `total` past the old 2000-char error slice.
  const facets = [{ field: "type", terms: Array.from({ length: 200 }, (_, i) => ({ key: `term-${i}`, doc_count: 0 })) }];
  fetchMock.mockResolvedValueOnce(reply(404, { "@graph": [], facets, total: 0, notification: "No results found" }));
  const result = await call("/search/", { type: "Experiment", "target.label": "NONEXISTENT" });
  expect(result.status).toBe(200);
  expect(result.data).toMatchObject({ "@graph": [], total: 0, notification: "No results found", __guard: { verified_empty: true, probed: "/search/" } });
});

it("keeps other 404s as errors", async () => {
  fetchMock.mockResolvedValueOnce(reply(404, { "@type": ["HTTPNotFound", "Error"], status: "error", code: 404, title: "Not Found" }));
  await expect(call("/experiments/ENCSR000BAD/")).rejects.toMatchObject({ status: 404, message: "ENCODE HTTP 404" });
});

it("does not treat a 404 with a non-zero total or a non-JSON body as empty", async () => {
  fetchMock.mockResolvedValueOnce(reply(404, { "@graph": [], total: 5 }));
  await expect(call("/search/", { type: "Experiment" })).rejects.toMatchObject({ status: 404 });
  fetchMock.mockResolvedValueOnce(reply(404, "<html>not json</html>"));
  await expect(call("/search/", { type: "Experiment" })).rejects.toMatchObject({ status: 404 });
});

it("does not certify an empty body on a non-404 failure", async () => {
  fetchMock.mockResolvedValueOnce(reply(500, { "@graph": [], total: 0 }));
  await expect(call("/search/", { type: "Experiment" })).rejects.toMatchObject({ status: 500 });
});
