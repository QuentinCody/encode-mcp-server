export function fail(message: string, status = 400, data?: unknown): never {
  throw Object.assign(new Error(message), { status, ...(data === undefined ? {} : { data }) });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Provider returned an invalid object", 502);
  return value as Record<string, unknown>;
}
export async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function readText(response: Response): Promise<string> {
  if (!response.body) fail("Provider returned no body", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) fail("Provider response exceeds 2MiB; narrow the query or use published bulk files", 502);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}
