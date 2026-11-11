import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ideas, pieces, pieceVersions } from "@/lib/db/schema";
import { StudioError } from "@/lib/errors";
import type { Language } from "@/lib/language";
import { getProfile } from "@/lib/profile";
import { renderSlides } from "@/lib/render";
import { slideBrand } from "@/lib/slides";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Downloads one slide as the JPEG that would be posted, for posting to Instagram by hand.
 * ?v= names the version on screen, so a download never silently comes from a newer version.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pieceId: string; slide: string }> }) {
  const { pieceId, slide } = await params;
  const version = Number(new URL(request.url).searchParams.get("v"));
  const number = Number(slide);
  if (!UUID.test(pieceId) || !Number.isInteger(version) || !Number.isInteger(number) || number < 1) {
    return new Response("Not found", { status: 404 });
  }

  const db = await getDb();
  const [row] = await db
    .select({ platform: pieces.platform, current: pieces.currentVersion, content: pieceVersions.content, language: ideas.language })
    .from(pieces)
    .innerJoin(pieceVersions, and(eq(pieceVersions.pieceId, pieces.id), eq(pieceVersions.version, version)))
    .innerJoin(ideas, eq(ideas.id, pieces.ideaId))
    .where(eq(pieces.id, pieceId));
  if (!row || row.platform !== "instagram") return new Response("Not found", { status: 404 });
  if (row.current !== version) {
    return new Response("This post changed since you opened it. Reload the page and download again.", { status: 409 });
  }

  try {
    const profile = await getProfile(db);
    if (!profile) return new Response("Finish Setup first.", { status: 409 });
    const images = await renderSlides(row.content, row.language as Language, slideBrand(profile));
    const image = images[number - 1];
    if (!image) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="instagram-${row.language}-slide-${number}.jpg"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof StudioError)) console.error(error);
    return new Response(error instanceof StudioError ? error.message : "The slide couldn't be made.", { status: 500 });
  }
}
