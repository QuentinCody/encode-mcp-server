import { fail } from "./response";

/** Metadata only: a single deadline includes headers/body and never awaits cancellation. */
export async function bulkMetadata(url: string, method: "GET" | "HEAD") {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); cancel(); reject(Object.assign(new Error("SCREEN bulk metadata deadline exceeded"), { status: 504 })); }, 15_000);
  });
  const work = async () => {
    const response = await fetch(url, { method, redirect: "manual", signal: controller.signal, headers: { Accept: "application/json", "Accept-Encoding": "identity" } });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); fail("SCREEN bulk metadata deadline exceeded", 504); }
    reader = response.body?.getReader();
    if (response.status !== 200 || response.headers.has("content-range")) fail(`SCREEN bulk metadata requires complete HTTP 200 (received ${response.status})`, response.status >= 400 ? response.status : 502);
    if (method === "HEAD") return { response, text: "" };
    if (!reader) fail("SCREEN bulk catalogue has no body", 502);
    return await readCatalogueBody(response, reader, controller);
  };
  try { return await Promise.race([work(), deadline]); }
  finally { clearTimeout(timer); cancel(); controller.abort(); }
}

async function readCatalogueBody(response: Response, reader: ReadableStreamDefaultReader<Uint8Array>, controller: AbortController) {
  const length = response.headers.get("content-length");
  const expected = length === null ? undefined : Number(length);
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(expected) || expected! > 262144)) fail("Invalid SCREEN catalogue Content-Length", 502);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0; let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (controller.signal.aborted) fail("SCREEN bulk metadata deadline exceeded", 504);
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 262144) fail("SCREEN bulk catalogue exceeds 256 KiB", 502);
    text += decoder.decode(value, { stream: true });
  }
  if (expected !== undefined && !response.headers.has("content-encoding") && bytes !== expected) fail("SCREEN catalogue differs from Content-Length", 502);
  return { response, text: text + decoder.decode() };
}
