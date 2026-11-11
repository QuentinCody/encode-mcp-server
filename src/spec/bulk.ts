import type { ApiEndpoint, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";
export const bulkEndpoints: ApiEndpoint[] = [
  { method: "GET", path: "/screen/bulk/catalog", category: "screen.bulk", featured: true,
    summary: "Discover public SCREEN Core Collection class matrix and individual gene-link files without an API key.",
    description: "Reads the provider's public download configuration and checks reviewed artifact identities. Returns exact URLs and the complete source configuration hash. Mutable branch/file URLs are not immutable releases; metadata is not downloaded-file validation." },
  { method: "GET", path: "/screen/bulk/manifest", category: "screen.bulk", featured: true,
    summary: "Pin one public SCREEN gzip file using the selected catalogue hash, native byte size and strong ETag.",
    description: "Metadata only. Local screen_bulk.py fetch/inspect/import/query commands perform bounded acquisition and occurrence-preserving SQLite ingestion with explicit column positions. API credentials and a hosted database are unnecessary. Native headers, every current file and Workerd execution still require qualification.",
    queryParams: [
      { name: "source_key", type: "string", required: true, description: "Exact artifact key returned by /screen/bulk/catalog" },
      { name: "expected_catalog_sha256", type: "string", required: true, description: "Exact catalogue source hash selected from discovery; changed configurations fail" },
    ] },
];
export const bulkWorkflows: WorkflowRecipe[] = [{
  title: "Discover public SCREEN class matrix and gene-link downloads",
  description: "Keyless file discovery. Preserve the full catalogue response or staging/error handle; select its source_key and catalog_sha256 for /screen/bulk/manifest. Then acquire and inspect locally before specifying column positions. Computational scores and experimental links retain distinct native meanings.",
  keywords: ["SCREEN", "bulk", "class matrix", "gene links", "SQLite"],
  code: 'return await api.get("/screen/bulk/catalog");',
}];
