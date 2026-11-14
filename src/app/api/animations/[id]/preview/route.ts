import { getDb } from "@/lib/db/client";
import { narrationOf, pageFor, requireAnimation } from "@/lib/animations";
import { brandForVideo } from "@/lib/video/render";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The animation as saved, playing in the browser with its narration, before any video is made. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const row = await requireAnimation(db, id).catch(() => null);
  if (!row) return new Response("Not found", { status: 404 });
  const play = new URL(request.url).searchParams.get("ui") === "fa" ? "پخش" : "Play";
  const audio = narrationOf(row) ? `/api/animations/${id}/narration` : null;
  const { html } = pageFor(row, await brandForVideo(db, row.language), { audio, playLabel: play });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
