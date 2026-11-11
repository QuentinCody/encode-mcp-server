import type { ApiEndpoint, ParamDef, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";
const assembly: ParamDef = { name: "assembly", type: "string", required: true, enum: ["grch38", "mm10"], description: "Explicit SCREEN assembly; gene links are documented only for human grch38" };
const accessions: ParamDef = { name: "accessions", type: "array", required: true, description: "1–10 exact cCRE IDs, EH38E... for grch38 or EM10E... for mm10" };
const pin: ParamDef = { name: "expected_response_sha256", type: "string", required: false, description: "Optional hash of the complete prior GraphQL response; detects changes, does not retrieve historical data" };
export const regulatoryEndpoints: ApiEndpoint[] = [
  {
    method: "GET", path: "/regulatory/manifest", category: "regulatory", featured: true,
    summary: "Adapter-owned release/assembly/checksum-pinned ENCODE cCRE or gene-link file manifest.",
    description: "Validates exact file accession, expected transferred-file MD5, assembly, Encyclopedia version, annotation membership and released/archived status. Retains complete file and annotation metadata, including audit, method/biosample context, derived_from, content_md5sum and supersession. Rechecks file metadata for drift. No file bytes are downloaded or verified.",
    queryParams: [
      { name: "file_accession", type: "string", required: true, description: "Exact ENCFF file accession selected from discovery" },
      { name: "assembly", type: "string", required: true, description: "Exact portal label: GRCh38, hg19, mm10, GRCm39 or T2T-CHM13" },
      { name: "encyclopedia_version", type: "string", required: true, description: "Explicit version, e.g. ENCODE v4; schema_version is not a data release" },
      { name: "expected_md5", type: "string", required: true, description: "Transferred-file md5sum from selected artifact metadata; differs from uncompressed content_md5sum" },
    ],
  },
  { method: "GET", path: "/screen/sources", category: "screen", summary: "Adapter-owned discovery of documented SCREEN API access, downloads and release history; no API key required.", description: "SCREEN published authorized API access in June 2026. Site releases, Registry versions and file checksums are distinct. Bulk class/matrix/gene-link data are available through published downloads; lifted hg19/hs1 files are not native callsets." },
  {
    method: "GET", path: "/screen/ccres", category: "screen", featured: true,
    summary: "Adapter-owned bounded SCREEN cCRE/max-z-score and nearest-gene query through the official GraphQL API.",
    description: "Requires host SCREEN_API_KEY. Retains coordinates/class and max signals, plus nearestgenes distance/gene. Nearest genes describe proximity, not causal regulation. Current API data release is unknown; use pinned portal/bulk files when version matters.",
    queryParams: [assembly, accessions, pin],
  },
  {
    method: "GET", path: "/screen/gene-links", category: "screen", featured: true,
    summary: "Adapter-owned human cCRE-to-gene experimental/eQTL/chromatin-contact evidence, retaining method and biosample/source context.",
    description: "Requires SCREEN_API_KEY. Retains p_val, effectsize, score, slope, guide/variant IDs, assay, experiment accession, tissue, celltype and source. No aggregation across methods or inferred causal status. No release-selection argument is documented.",
    queryParams: [assembly, accessions, pin],
  },
  {
    method: "GET", path: "/screen/linked-ccres", category: "screen", summary: "Adapter-owned reverse human gene-to-cCRE link evidence query.",
    queryParams: [assembly, { name: "gene_ids", type: "array", required: true, description: "Exactly one unversioned Ensembl human gene ID (ENSG plus 11 digits)" }, pin],
    description: "Host SCREEN_API_KEY required; same method/source context as /screen/gene-links. Provider docs have no total-count/cursor contract; a returned array is not proof of complete regulatory coverage.",
  },
  {
    method: "GET", path: "/screen/computational-links", category: "screen", summary: "Adapter-owned cCRE-to-gene predictions using explicitly selected SCREEN methods; distinct from observed links.",
    queryParams: [assembly, accessions, { name: "methods", type: "array", required: true, description: "1–6 choices: ABC_(DNase_only), ABC_(full), EPIraction, GraphRegLR, rE2G_(DNase_only), rE2G_(extended)" }, pin],
    description: "Human only; host SCREEN_API_KEY required. Retains method, celltype, score, methodregion and fileaccession. These scores have method-specific meanings and must not be pooled as a common confidence measure. Official ComputationalGeneLinksQuery has no assembly argument; the adapter restricts inputs to human EH38E accessions.",
  },
];
export const regulatoryWorkflows: WorkflowRecipe[] = [
  {
    title: "Discover release-specific ENCODE cCRE files",
    description: "One bounded native file-search page. Keep the complete @graph/total/audit envelope; a limit is not a complete release. Select an exact file and md5sum for /regulatory/manifest before download or coordinate analysis.",
    keywords: ["cCRE", "ENCODE v4", "release", "assembly", "regulatory"],
    code: 'return await api.get("/search/", { type: "File", output_type: "candidate Cis-Regulatory Elements", encyclopedia_version: "ENCODE v4", assembly: "GRCh38", status: "released", frame: "object", limit: 10 });',
  },
  {
    title: "Discover release-specific ENCODE gene-link artifacts",
    description: "Find exact gene-link artifacts in an explicitly selected Encyclopedia/assembly. Inspect method, biosample, annotation and source provenance. Narrow a partial search rather than assuming all files were returned. An empty page may mean this product has no files under the selected version.",
    keywords: ["gene linking", "element gene links", "release", "manifest"],
    code: 'return await api.get("/search/", { type: "File", output_type: ["element gene links", "enhancer-gene links", "thresholded element gene links"], encyclopedia_version: "ENCODE v4", assembly: "GRCh38", status: "released", frame: "object", limit: 10 });',
  },
  {
    title: "Pin a selected ENCODE cCRE artifact",
    description: "Concrete provider-metadata example. Rejects drift in accession/checksum/version/assembly; no automatic replacement. Select your own artifact pins for another dataset. Metadata validation does not verify downloaded bytes.",
    keywords: ["checksum", "pinned", "ENCFF709QDL", "ENCODE v4"],
    code: 'return await api.get("/regulatory/manifest", { file_accession: "ENCFF709QDL", assembly: "GRCh38", encyclopedia_version: "ENCODE v4", expected_md5: "e3e5b2ce351d1d9234765a40528a050e" });',
  },
  {
    title: "SCREEN cCRE gene-link evidence with method context",
    description: "Official authorized GraphQL access via the adapter. Requires host SCREEN_API_KEY; no historical data release is documented. Preserve returned source/method/biosample details, errors and staging handles. Use /screen/ccres separately for proximity and /screen/computational-links for predictions.",
    keywords: ["SCREEN", "gene links", "CRISPR", "eQTL", "Hi-C"],
    code: 'return await api.get("/screen/gene-links", { assembly: "grch38", accessions: ["EH38E1516972"] });',
  },
];
