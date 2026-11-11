import { expect, it, vi } from "vitest";
import { regulatoryManifest } from "./regulatory";

const params = { file_accession: "ENCFF709QDL", assembly: "GRCh38", encyclopedia_version: "ENCODE v4", expected_md5: "e3e5b2ce351d1d9234765a40528a050e" };
const file = { accession: "ENCFF709QDL", assembly: "GRCh38", encyclopedia_version: ["ENCODE v4"], md5sum: params.expected_md5, content_md5sum: "db21af8044be1457a88c770104e49783", dataset: "/annotations/ENCSR211XST/", href: "/files/ENCFF709QDL/@@download/ENCFF709QDL.bed.gz", file_size: 32617318, output_type: "candidate Cis-Regulatory Elements", status: "released", no_file_available: false, derived_from: ["/files/ENCFF192IUT/"], superseded_by: [], audit: { WARNING: [{ detail: "fixture warning" }] } };
const annotation = { accession: "ENCSR211XST", encyclopedia_version: "ENCODE v4", status: "released", description: "fixture biosample annotation", biosample_ontology: "/biosample-types/cell_line_EFO_0002067/", documents: ["/documents/fixture/"] };
const get = (first: unknown = file, parent: unknown = annotation, second: unknown = first) => vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(parent).mockResolvedValueOnce(second);

it("pins version, assembly and transferred bytes while retaining full annotation and audit metadata", async () => {
  const fetch = get();
  expect(await regulatoryManifest(params, fetch)).toMatchObject({ files: [file], annotations: [annotation], _encode: { selection: params, artifact_bytes_verified: false, metadata_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), checksum_note: expect.stringContaining("uncompressed") } });
  expect(fetch.mock.calls).toEqual([["/files/ENCFF709QDL/", { frame: "object" }], ["/annotations/ENCSR211XST/", { frame: "object" }], ["/files/ENCFF709QDL/", { frame: "object" }]]);
});
it.each([
  { file_accession: "../file" }, { assembly: "hg38" }, { encyclopedia_version: "latest" }, { expected_md5: undefined }, { expected_md5: "short" }, { format: "xml" },
])("rejects incomplete or ambiguous pins before fetching %#", async override => {
  const fetch = vi.fn();
  await expect(regulatoryManifest({ ...params, ...override }, fetch)).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  { accession: "ENCFF000AAA" }, { assembly: "hg19" }, { encyclopedia_version: ["ENCODE v3"] }, { md5sum: "0".repeat(32) }, { status: "revoked" }, { no_file_available: true },
])("rejects selection drift or unavailable artifacts %#", async override => {
  await expect(regulatoryManifest(params, get({ ...file, ...override }))).rejects.toMatchObject({ status: 409 });
});
it.each([{ dataset: "https://evil.example/annotations/ENCSR211XST/" }, { dataset: "/experiments/ENCSR211XST/" }, { href: "https://evil.example/file.bed" }, { href: "/files/ENCFF709QDL/@@download/../file" }, { file_size: 0 }, { file_size: "123" }])("rejects malformed file metadata or links %#", async override => {
  await expect(regulatoryManifest(params, get({ ...file, ...override }))).rejects.toMatchObject({ status: 502 });
});
it.each([{ accession: "ENCSR000AAA" }, { encyclopedia_version: "ENCODE v3" }, { status: "revoked" }])("rejects parent annotation disagreement %#", async override => {
  await expect(regulatoryManifest(params, get(file, { ...annotation, ...override }))).rejects.toMatchObject({ status: 409 });
});
it("detects metadata drift even when the file checksum remains the same", async () => {
  await expect(regulatoryManifest(params, get(file, annotation, { ...file, audit: {} }))).rejects.toMatchObject({ status: 409 });
});
it("allows an explicitly pinned archived gene-link file without replacing it with a released one", async () => {
  const archived = { ...file, output_type: "element gene links", status: "archived", superseded_by: ["/files/ENCFF000AAA/"] };
  const result = await regulatoryManifest(params, get(archived, { ...annotation, status: "archived" }));
  expect(result.files).toEqual([archived]);
});
it("does not conflate compressed and uncompressed checksums", async () => {
  await expect(regulatoryManifest({ ...params, expected_md5: file.content_md5sum }, get())).rejects.toMatchObject({ status: 409 });
});
