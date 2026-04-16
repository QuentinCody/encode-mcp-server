import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class EncodeDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        const obj = data as Record<string, unknown>;

        // Portal search: top-level object with "@graph" holding the records
        if (Array.isArray(obj["@graph"])) {
            const sample = obj["@graph"][0];
            if (sample && typeof sample === "object") {
                const sampleObj = sample as Record<string, unknown>;
                const atType = Array.isArray(sampleObj["@type"]) ? (sampleObj["@type"] as string[])[0] : undefined;
                const base = typeof atType === "string" ? atType.toLowerCase() : "records";
                return {
                    tableName: `${base}_results`,
                    indexes: ["accession", "status", "@id"],
                };
            }
        }

        // Array response (raw collection)
        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                return {
                    tableName: "encode_records",
                    indexes: ["accession", "status"],
                };
            }
        }

        // Single object lookup
        if (typeof obj.accession === "string" && obj["@type"]) {
            return {
                tableName: "encode_object",
                indexes: ["accession"],
            };
        }

        return undefined;
    }
}
