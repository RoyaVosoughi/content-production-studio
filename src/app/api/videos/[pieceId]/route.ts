import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ideas, pieces, pieceVersions } from "@/lib/db/schema";
import { isVideoPlatform } from "@/lib/platforms";
import { brandForVideo, renderKey, thumbnailFile, videoFile } from "@/lib/video/render";
import { fileResponse } from "@/lib/video/serve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The finished video, or its thumbnail with ?thumbnail=1, for the version on screen (?v=).
 * ?download=1 saves it as a file, for posting by hand.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pieceId: string }> }) {
  const { pieceId } = await params;
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v"));
  if (!UUID.test(pieceId) || !Number.isInteger(version)) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const [row] = await db
    .select({ platform: pieces.platform, current: pieces.currentVersion, content: pieceVersions.content, language: ideas.language })
    .from(pieces)
    .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, version)))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .where(eq(pieces.id, pieceId));
  if (!row || !isVideoPlatform(row.platform) || !row.content.footage) return new Response("Not found", { status: 404 });
  if (row.current !== version) {
    return new Response("This video changed since you opened it. Reload the page and download again.", { status: 409 });
  }

  const key = renderKey(row.platform, row.language, row.content.footage, row.content, await brandForVideo(db, row.language));
  const name = `${row.platform}-${row.language}`;
  const download = url.searchParams.get("download") === "1";
  if (url.searchParams.get("thumbnail") === "1") {
    return fileResponse(request, thumbnailFile(key), { type: "image/jpeg", download: download ? `${name}-thumbnail.jpg` : undefined });
  }
  return fileResponse(request, videoFile(key), { type: "video/mp4", download: download ? `${name}.mp4` : undefined });
}
