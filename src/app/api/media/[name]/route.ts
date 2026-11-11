import { readPhoto } from "@/lib/media";

/** Serves a cover photo you uploaded, for the slide preview. Only the studio's own file names are accepted. */
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const photo = await readPhoto(name);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
