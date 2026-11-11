import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { footage } from "@/lib/db/schema";
import { footagePath } from "@/lib/video/footage";
import { fileResponse } from "@/lib/video/serve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };

/** Plays your original clip in the editor, so you can check each phrase before cutting it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const [clip] = await (await getDb()).select().from(footage).where(eq(footage.id, id));
  const file = clip ? footagePath(clip.file) : null;
  if (!clip || !file) return new Response("Not found", { status: 404 });
  return fileResponse(request, file, { type: TYPES[clip.file.split(".").pop() ?? ""] ?? "video/mp4" });
}
