import { receiveSample } from "@/lib/agents/editor/samples";
import { getDb } from "@/lib/db/client";
import { StudioError } from "@/lib/errors";
import { fromStudioPage } from "@/lib/video/serve";

/** Receives a sample video for the Video Editor, streamed straight to the editor's own folder. */
export async function POST(request: Request) {
  if (!fromStudioPage(request)) return Response.json({ error: "Uploads only work from the studio." }, { status: 403 });
  const header = (name: string) => decodeURIComponent(request.headers.get(name) ?? "");
  if (!request.body) return Response.json({ error: "Choose a video first." }, { status: 400 });
  try {
    await receiveSample(await getDb(), request.body, {
      originalName: header("x-file-name"),
      size: Number(request.headers.get("content-length")),
      language: header("x-language"),
      platform: header("x-platform"),
      note: header("x-note"),
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    const message = error instanceof StudioError ? error.message : "The upload didn't work. Please try again.";
    return Response.json({ error: message }, { status: 400 });
  }
}
