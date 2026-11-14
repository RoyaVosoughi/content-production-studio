import path from "node:path";
import { getDb } from "@/lib/db/client";
import { StudioError } from "@/lib/errors";
import { addNarration, MAX_NARRATION_BYTES, NARRATION_DIR, NARRATION_EXTENSIONS, narrationPath, requireAnimation } from "@/lib/animations";
import { saveFootageStream } from "@/lib/video/footage";
import { fileResponse, fromStudioPage } from "@/lib/video/serve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** Plays the narration, for the preview. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const row = await requireAnimation(await getDb(), id).catch(() => null);
  const file = row?.narration ? narrationPath(row.narration) : null;
  if (!file) return new Response("Not found", { status: 404 });
  return fileResponse(request, file, { type: TYPES[path.extname(file).slice(1)] ?? "application/octet-stream" });
}

/** Receives a recording of the script, streamed to disk, and starts reading it with Whisper. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!fromStudioPage(request)) return Response.json({ error: "Uploads only work from the studio." }, { status: 403 });
  const { id } = await params;
  const name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  const size = Number(request.headers.get("content-length"));
  if (!UUID.test(id) || !request.body) return Response.json({ error: "Reload the page and try again." }, { status: 400 });
  try {
    const db = await getDb();
    await requireAnimation(db, id);
    const file = await saveFootageStream(request.body, name, size, {
      dir: NARRATION_DIR(),
      maxBytes: MAX_NARRATION_BYTES,
      extensions: NARRATION_EXTENSIONS,
      wrongType: "Use an MP3, M4A, WAV, AAC, OGG or FLAC recording, or a video with your voice.",
    });
    await addNarration(db, id, { file, originalName: name });
    return Response.json({ ok: true });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    const message = error instanceof StudioError ? error.message : "The upload didn't work. Please try again.";
    return Response.json({ error: message }, { status: 400 });
  }
}
