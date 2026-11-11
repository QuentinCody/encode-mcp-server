import { afterEach, expect, it, vi } from "vitest";
import { bulkMetadata } from "./bulk-http";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const url = "https://example.org/config";
it.each([206, 301, 404])("rejects incomplete/non-200 HTTP %s", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("partial", { status })));
  await expect(bulkMetadata(url, "GET")).rejects.toThrow("complete HTTP 200");
});
it.each(["GET", "HEAD"] as const)("rejects Content-Range even on HTTP 200 %s", async method => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { headers: { "content-range": "bytes 0-1/10" } })));
  await expect(bulkMetadata(url, method)).rejects.toThrow("complete HTTP 200");
});
it.each(["262145", "NaN", "1.5", "-1"])("rejects invalid catalogue size %s", async length => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-length": length } })));
  await expect(bulkMetadata(url, "GET")).rejects.toThrow("Content-Length");
});
it.each([new Uint8Array([0xc3]), new Uint8Array([0xff])])("rejects invalid/incomplete UTF-8 %#", async bytes => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  await expect(bulkMetadata(url, "GET")).rejects.toThrow();
});
it("accounts for actual UTF-8 bytes and tolerates split multibyte codepoints", async () => {
  const bytes = new TextEncoder().encode('\ufeff{"λ":true}');
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-length": String(bytes.length) } })));
  expect((await bulkMetadata(url, "GET")).text).toBe('{"λ":true}');
});
it("rejects a truncated body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-length": "10" } })));
  await expect(bulkMetadata(url, "GET")).rejects.toThrow("differs from Content-Length");
});
it("enforces the streamed size even without a declared length", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("λ".repeat(131073))));
  await expect(bulkMetadata(url, "GET")).rejects.toThrow("exceeds 256 KiB");
});
it("settles a stalled body even when cancellation never acknowledges", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
  const checked = expect(bulkMetadata(url, "GET")).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(15000); await checked; expect(cancel).toHaveBeenCalled();
});
it("cancels a late response after the header deadline", async () => {
  vi.useFakeTimers(); let finish!: (response: Response) => void; const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const checked = expect(bulkMetadata(url, "GET")).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(15000); await checked;
  finish(new Response(new ReadableStream({ cancel }))); await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalled();
});
