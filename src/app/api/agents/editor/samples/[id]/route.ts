import { eq } from "drizzle-orm";
import { samplePath } from "@/lib/agents/editor/samples";
import { getDb } from "@/lib/db/client";
import { editorSamples } from "@/lib/db/schema";
import { fileResponse } from "@/lib/video/serve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };

/** Plays a sample video on the editor's page. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const [sample] = await (await getDb()).select().from(editorSamples).where(eq(editorSamples.id, id));
  const file = sample ? samplePath(sample.file) : null;
  if (!sample || !file) return new Response("Not found", { status: 404 });
  return fileResponse(request, file, { type: TYPES[sample.file.split(".").pop() ?? ""] ?? "video/mp4" });
}
