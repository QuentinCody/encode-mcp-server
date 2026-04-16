import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const encodeCatalog: ApiCatalog = {
    name: "ENCODE",
    baseUrl: "https://www.encodeproject.org",
    auth: "none",
    endpointCount: 12,
    notes:
        "- ENCODE (Encyclopedia of DNA Elements) hosts functional genomics data: experiments, biosamples, files, annotations.\n" +
        "- ALWAYS send `Accept: application/json` and `format=json` in query params — HTML is the default content-type.\n" +
        "- Object-lookup endpoints (`/<type>/<accession>/`) return a single record with ~100 nested fields. Use `frame=object` to skip embedded expansions.\n" +
        "- Portal-style search (`/search/`) returns a wrapped JSON object with `@graph` as the records array — use `record_path: 'data'` or extract `@graph` in Code Mode.\n" +
        "- Keep `limit=10` and `max_items=10` on search endpoints; full ENCODE result sets are huge.\n" +
        "- Accession prefixes: ENCSR* experiment, ENCBS* biosample, ENCFF* file, ENCLB* library, ENCAN* annotation, ENCDO* donor.\n" +
        "- Docs: https://www.encodeproject.org/help/rest-api/ — full types: https://www.encodeproject.org/profiles/",
    endpoints: [
        // Object-lookup category
        {
            method: "GET",
            path: "/experiments/{accession}/",
            summary: "Get a single ENCODE experiment by accession (ENCSR...)",
            description: "Returns all experiment metadata: biosample, assay, target, replicates, files, analyses.",
            category: "object_lookup",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Experiment accession (e.g. ENCSR000AAA)" },
            ],
            queryParams: [
                { name: "frame", type: "string", required: false, description: "Response frame: object (plain) | embedded (expanded) | raw", enum: ["object", "embedded", "raw"] },
                { name: "format", type: "string", required: false, description: "Force JSON response", default: "json" },
            ],
            featured: true,
        },
        {
            method: "GET",
            path: "/biosamples/{accession}/",
            summary: "Get a single biosample (ENCBS...)",
            category: "object_lookup",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Biosample accession (e.g. ENCBS000AAA)" },
            ],
            queryParams: [
                { name: "frame", type: "string", required: false, description: "object | embedded", enum: ["object", "embedded"] },
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },
        {
            method: "GET",
            path: "/files/{accession}/",
            summary: "Get a single file (ENCFF...) — fastq, bam, bed, bigWig, etc.",
            category: "object_lookup",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "File accession (e.g. ENCFF000AAA)" },
            ],
            queryParams: [
                { name: "frame", type: "string", required: false, description: "object | embedded" },
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },
        {
            method: "GET",
            path: "/libraries/{accession}/",
            summary: "Get a single library (ENCLB...)",
            category: "object_lookup",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Library accession" },
            ],
            queryParams: [
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },
        {
            method: "GET",
            path: "/annotations/{accession}/",
            summary: "Get a functional annotation (ENCAN...) — e.g. cCREs, candidate regulatory elements",
            category: "object_lookup",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Annotation accession" },
            ],
            queryParams: [
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },
        {
            method: "GET",
            path: "/targets/{name}/",
            summary: "Get a target/gene record (e.g. /targets/CTCF-human/)",
            category: "object_lookup",
            pathParams: [
                { name: "name", type: "string", required: true, description: "Target name (e.g. CTCF-human)" },
            ],
            queryParams: [
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },
        {
            method: "GET",
            path: "/donors/{accession}/",
            summary: "Get a donor record (ENCDO...)",
            category: "object_lookup",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Donor accession" },
            ],
            queryParams: [
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },

        // Portal search category
        {
            method: "GET",
            path: "/search/",
            summary: "Portal-wide search across any ENCODE object type",
            description:
                "Faceted search. Results are wrapped — records are in `@graph`. Use `type=Experiment` (etc) to scope the search. Keep `limit` small (≤25).",
            category: "portal_search",
            queryParams: [
                { name: "type", type: "string", required: true, description: "Object type to search (Experiment, Biosample, File, Annotation, FunctionalCharacterizationExperiment, etc.)" },
                { name: "searchTerm", type: "string", required: false, description: "Free-text query" },
                { name: "assay_title", type: "string", required: false, description: "Filter by assay (e.g. 'RNA-seq', 'ChIP-seq', 'ATAC-seq')" },
                { name: "biosample_ontology.term_name", type: "string", required: false, description: "Filter by biosample term (e.g. 'K562', 'HepG2')" },
                { name: "target.label", type: "string", required: false, description: "Filter by target (e.g. 'CTCF')" },
                { name: "status", type: "string", required: false, description: "Filter by status (released | in progress | archived)" },
                { name: "limit", type: "number", required: false, description: "Max results (use small values; default varies)", default: 10 },
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
            featured: true,
            usageHint: "Results live under `@graph`. Set `record_path: 'data'` or read `response['@graph']` directly.",
        },
        {
            method: "GET",
            path: "/matrix/",
            summary: "Get a faceted matrix view of ENCODE data (biosample × assay, etc.)",
            category: "portal_search",
            queryParams: [
                { name: "type", type: "string", required: true, description: "Object type (usually Experiment)" },
                { name: "assay_title", type: "string", required: false, description: "Filter assays" },
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },
        {
            method: "GET",
            path: "/report/",
            summary: "Tabular report view (flat columns) for a given object type",
            category: "portal_search",
            queryParams: [
                { name: "type", type: "string", required: true, description: "Object type" },
                { name: "field", type: "array", required: false, description: "Columns to include (repeatable)" },
                { name: "limit", type: "number", required: false, description: "Max rows", default: 25 },
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
        },

        // Reference / meta
        {
            method: "GET",
            path: "/profiles/{type}.json",
            summary: "Get the JSON schema profile for an ENCODE object type",
            description: "Useful for discovering fields and enums for a given object type.",
            category: "reference",
            pathParams: [
                { name: "type", type: "string", required: true, description: "Object type name (e.g. 'experiment', 'biosample', 'file')" },
            ],
        },
        {
            method: "GET",
            path: "/search/",
            summary: "Shortcut: Annotation search (cCREs, ChromHMM, candidate regulatory elements)",
            description: "Same /search/ endpoint but scoped to Annotation — returned here for discoverability.",
            category: "portal_search",
            queryParams: [
                { name: "type", type: "string", required: true, description: "Must be 'Annotation'", enum: ["Annotation"] },
                { name: "annotation_type", type: "string", required: false, description: "e.g. 'candidate Cis-Regulatory Elements'" },
                { name: "assembly", type: "string", required: false, description: "Genome assembly (GRCh38, mm10)" },
                { name: "limit", type: "number", required: false, description: "Max results", default: 10 },
                { name: "format", type: "string", required: false, description: "Force JSON", default: "json" },
            ],
            usageHint: "Duplicate of /search/ — separate category entry for quick discovery.",
        },
    ],
};
