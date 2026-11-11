import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Sends a file in the parts the browser asks for, which lets a video player jump to any moment
 * without downloading the whole clip first.
 */
export async function fileResponse(
  request: Request,
  file: string,
  { type, download }: { type: string; download?: string },
): Promise<Response> {
  let size: number;
  try {
    size = (await stat(/*turbopackIgnore: true*/ file)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    ...(download && { "Content-Disposition": `attachment; filename="${download}"` }),
  };
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}

/** Uploads must come from the studio's own page, never from another site open in the browser. */
export function fromStudioPage(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && new URL(origin).host === new URL(request.url).host;
}
