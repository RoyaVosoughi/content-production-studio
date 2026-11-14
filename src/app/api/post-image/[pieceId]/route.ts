import { and, eq } from "drizzle-orm";
import { imageOf } from "@/lib/content";
import { getDb } from "@/lib/db/client";
import { ideas, pieces, pieceVersions } from "@/lib/db/schema";
import { StudioError } from "@/lib/errors";
import type { Language } from "@/lib/language";
import type { Platform } from "@/lib/platforms";
import { getProfile } from "@/lib/profile";
import { renderPostImage } from "@/lib/render";
import { slideBrand } from "@/lib/slides";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Downloads the brand image of a LinkedIn post or an article as the JPEG that would be posted.
 * ?v= names the version on screen, so a download never silently comes from a newer version.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pieceId: string }> }) {
  const { pieceId } = await params;
  const version = Number(new URL(request.url).searchParams.get("v"));
  if (!UUID.test(pieceId) || !Number.isInteger(version)) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const [row] = await db
    .select({ platform: pieces.platform, current: pieces.currentVersion, content: pieceVersions.content, language: ideas.language })
    .from(pieces)
    .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, version)))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .where(eq(pieces.id, pieceId));
  const image = row ? imageOf(row.platform as Platform, row.content) : null;
  if (!row || !image) return new Response("Not found", { status: 404 });
  if (row.current !== version) {
    return new Response("This post changed since you opened it. Reload the page and download again.", { status: 409 });
  }

  try {
    const profile = await getProfile(db);
    if (!profile) return new Response("Finish Setup first.", { status: 409 });
    const jpeg = await renderPostImage(image, row.language as Language, slideBrand(profile));
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${row.platform}-${row.language}-image.jpg"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    return new Response(error instanceof StudioError ? error.message : "The image couldn't be made.", { status: 500 });
  }
}
