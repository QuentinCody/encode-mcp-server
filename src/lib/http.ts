import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const ENCODE_BASE = "https://www.encodeproject.org";

export interface EncodeFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the ENCODE portal REST API.
 *
 * ENCODE defaults to HTML responses — we force JSON via both the Accept header
 * AND a default `format=json` query param to keep portal-search + object-lookup
 * endpoints consistent.
 */
export async function encodeFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: EncodeFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? ENCODE_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    // Always request JSON via query param — ENCODE uses content negotiation
    // via both Accept header AND `?format=json`. Belt-and-suspenders.
    const effectiveParams: Record<string, unknown> = {
        format: "json",
        ...(params ?? {}),
    };

    return restFetch(baseUrl, path, effectiveParams, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 45_000,
        userAgent: "encode-mcp-server/1.0 (bio-mcp)",
    });
}
