import { getDb } from "@/lib/db/client";
import { animationFile, animationName, animationState } from "@/lib/animations";
import { fileResponse } from "@/lib/video/serve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The finished animation for the scenes as saved now. ?download=1 saves it as a file. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const state = await animationState(await getDb(), id).catch(() => null);
  if (!state?.ready) return new Response("This animation changed since you opened it. Reload the page.", { status: 409 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return fileResponse(request, animationFile(state.key), { type: "video/mp4", download: download ? `${animationName(state.row)}.mp4` : undefined });
}
