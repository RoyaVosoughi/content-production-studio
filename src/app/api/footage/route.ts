import { addFootage } from "@/lib/content";
import { getDb } from "@/lib/db/client";
import { StudioError } from "@/lib/errors";
import { saveFootageStream } from "@/lib/video/footage";
import { fromStudioPage } from "@/lib/video/serve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Receives a clip you filmed, streamed straight to disk, and uses it for one video.
 * A clip can be gigabytes, which is too big for a form action, so the page sends it here.
 */
export async function POST(request: Request) {
  if (!fromStudioPage(request)) return Response.json({ error: "Uploads only work from the studio." }, { status: 403 });
  const url = new URL(request.url);
  const pieceId = url.searchParams.get("pieceId") ?? "";
  const version = Number(url.searchParams.get("version"));
  const name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  const size = Number(request.headers.get("content-length"));
  if (!UUID.test(pieceId) || !Number.isInteger(version) || !request.body) {
    return Response.json({ error: "Reload the page and try again." }, { status: 400 });
  }
  try {
    const file = await saveFootageStream(request.body, name, size);
    await addFootage(await getDb(), pieceId, version, { file, originalName: name, size });
    return Response.json({ ok: true });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    const message = error instanceof StudioError ? error.message : "The upload didn't work. Please try again.";
    return Response.json({ error: message }, { status: 400 });
  }
}
