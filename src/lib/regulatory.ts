import { fail, hash, object } from "./response";
type Params = Record<string, unknown>;
type Get = (path: string, params?: Params) => Promise<unknown>;
const outputTypes = ["candidate Cis-Regulatory Elements", "element gene links", "enhancer-gene links", "thresholded element gene links", "thresholded links"];
const hasVersion = (value: unknown, version: unknown) => value === version || (Array.isArray(value) && value.includes(version));

function checkFile(value: unknown, params: Params) {
  const file = object(value);
  if (file.accession !== params.file_accession || file.assembly !== params.assembly) fail("ENCODE file identifier or assembly differs from the requested pin", 409);
  if (!hasVersion(file.encyclopedia_version, params.encyclopedia_version)) fail("ENCODE file does not establish the requested Encyclopedia version", 409);
  if (typeof file.md5sum !== "string" || file.md5sum.toLowerCase() !== String(params.expected_md5).toLowerCase()) fail("ENCODE file checksum differs from expected_md5", 409);
  if (!["released", "archived"].includes(String(file.status)) || file.no_file_available === true) fail("ENCODE file is unavailable or not a released/archived artifact", 409);
  if (!outputTypes.includes(String(file.output_type))) fail("Selected file is not a supported cCRE or gene-link annotation", 400);
  if (typeof file.dataset !== "string" || !/^\/annotations\/ENCSR[A-Z0-9]{6}\/$/.test(file.dataset)) fail("ENCODE file does not reference an annotation dataset", 502);
  if (typeof file.href !== "string" || !file.href.startsWith(`/files/${params.file_accession}/@@download/`) || file.href.includes("?") || file.href.includes("#") || file.href.includes("..")) fail("ENCODE file has no safe accession-scoped download path", 502);
  if (!Number.isSafeInteger(file.file_size) || Number(file.file_size) <= 0) fail("ENCODE file has no valid file size", 502);
  return file;
}
export async function regulatoryManifest(params: Params, get: Get) {
  const allowed = new Set(["file_accession", "assembly", "encyclopedia_version", "expected_md5"]);
  for (const key of Object.keys(params)) if (!allowed.has(key)) fail(`Unsupported manifest parameter: ${key}`);
  if (typeof params.file_accession !== "string" || !/^ENCFF[A-Z0-9]{6}$/.test(params.file_accession)) fail("file_accession must be an exact ENCFF accession");
  if (!["GRCh38", "hg19", "mm10", "GRCm39", "T2T-CHM13"].includes(String(params.assembly))) fail("Select an explicit ENCODE assembly label");
  if (typeof params.encyclopedia_version !== "string" || !/^ENCODE v[1-9]\d*$/.test(params.encyclopedia_version)) fail("Select an explicit Encyclopedia version (e.g. ENCODE v4)");
  if (typeof params.expected_md5 !== "string" || !/^[a-f0-9]{32}$/i.test(params.expected_md5)) fail("expected_md5 must pin the transferred-file checksum from file metadata");
  const path = `/files/${params.file_accession}/`;
  const before = checkFile(await get(path, { frame: "object" }), params);
  const annotation = object(await get(String(before.dataset), { frame: "object" }));
  if (`/annotations/${annotation.accession}/` !== before.dataset || !hasVersion(annotation.encyclopedia_version, params.encyclopedia_version)) fail("Annotation dataset disagrees with the file's release provenance", 409);
  if (!["released", "archived"].includes(String(annotation.status))) fail("Annotation is not released or archived", 409);
  const after = checkFile(await get(path, { frame: "object" }), params);
  if (await hash(before) !== await hash(after)) fail("ENCODE file metadata changed during manifest retrieval; retry", 409);
  return {
    files: [before], annotations: [annotation],
    _encode: {
      retrieved_at: new Date().toISOString(), source_url: `https://www.encodeproject.org${path}`,
      selection: params, metadata_sha256: await hash({ file: before, annotation }),
      download_url: `https://www.encodeproject.org${before.href}`, artifact_bytes_verified: false,
      checksum_note: "md5sum pins transferred bytes; content_md5sum, when present, hashes uncompressed bytes. This operation validates metadata, not downloaded bytes.",
      release_note: "File accession/checksum, Encyclopedia version and assembly are explicit. Metadata observations do not create an atomic or historical portal snapshot; annotation/file metadata are retained in full.",
      coordinate_note: "Use the selected artifact's format and schema. BED uses zero-based, half-open intervals; do not silently mix assemblies or assume lifted coordinates are native calls.",
      interpretation: "cCREs are candidates. Gene-link scores and evidence depend on method and biosample; proximity alone does not demonstrate regulation. Preserve source identifiers and methods when joining.",
    },
  };
}
