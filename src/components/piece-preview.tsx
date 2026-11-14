import type { PieceContent } from "@/lib/db/schema";
import { textDirection, type Language } from "@/lib/language";
import type { Platform } from "@/lib/platforms";
import { SLIDE_SIZE, slideHtml, type SlideBrand } from "@/lib/slides";
import { Markdown } from "./markdown";
import { ImageFrame } from "./post-image-editor";

/** Who the post is from, as each preview shows it. Comes from Setup. */
export type PreviewBrand = {
  /** The name as written in the post's language. */
  name: string;
  headline: string;
  /** The Instagram handle without the @, or the name. */
  instagram: string;
  slides: SlideBrand;
  websiteUrl: string;
  /** The article's address on the website, once a slug is known. Null without a website. */
  articleUrl: string | null;
};

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-navy font-semibold text-white">
      {[...name.trim()][0]?.toUpperCase() ?? "•"}
    </span>
  );
}

const SCALE = 0.25;

/**
 * Each slide is the exact page that becomes the posted image, shown at a quarter of its size.
 * The frames are sandboxed: they only display the slide.
 */
function InstagramPreview({ content, language, brand }: { content: PieceContent; language: Language; brand: PreviewBrand }) {
  const slides = content.slides ?? [];
  const photoSrc = content.photo ? `/api/media/${content.photo}` : null;
  return (
    <div className="rounded-lg border border-[#d9d4cc] bg-white p-3 text-[#1e1e1e]">
      <div className="flex items-center gap-2">
        <Avatar name={brand.name} />
        <p className="text-sm font-semibold" dir="ltr">
          {brand.instagram}
        </p>
      </div>
      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-2" dir="ltr" data-slides>
        {slides.map((slide, index) => (
          <div
            key={index}
            className="shrink-0 snap-start overflow-hidden rounded-md bg-mist"
            style={{ width: SLIDE_SIZE.width * SCALE, height: SLIDE_SIZE.height * SCALE }}
          >
            <iframe
              title={`${index + 1} / ${slides.length}`}
              sandbox=""
              srcDoc={slideHtml(slide, { index, total: slides.length, language, photoSrc, brand: brand.slides })}
              width={SLIDE_SIZE.width}
              height={SLIDE_SIZE.height}
              className="pointer-events-none origin-top-left border-0"
              style={{ transform: `scale(${SCALE})` }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed" dir={textDirection(language)}>
        <span className="font-semibold" dir="ltr">
          {brand.instagram}
        </span>{" "}
        {content.body}
      </p>
    </div>
  );
}

/** An approximation of each platform's look, so line breaks and length can be judged before posting. */
export function PiecePreview({
  platform,
  content,
  language,
  brand,
}: {
  platform: Platform;
  content: PieceContent;
  /** The language the post is written in. */
  language: Language;
  brand: PreviewBrand;
}) {
  const dir = textDirection(language);
  if (platform === "telegram") {
    return (
      <div className="rounded-lg bg-[#d5e3ef] p-3 text-[#1e1e1e]" lang={language} dir={dir}>
        <div className="max-w-md rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm font-semibold text-[#2b7fc1]">{brand.name}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">{content.body}</p>
        </div>
      </div>
    );
  }
  if (platform === "linkedin") {
    return (
      <div className="rounded-lg border border-[#d9d4cc] bg-white p-4 text-[#1e1e1e]" lang={language} dir={dir}>
        <div className="flex items-center gap-2">
          <Avatar name={brand.name} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{brand.name}</p>
            {brand.headline && <p className="truncate text-xs text-[#666666]">{brand.headline}</p>}
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{content.body}</p>
        {content.image && (
          <div className="-mx-4 mt-3">
            <ImageFrame image={content.image} language={language} brand={brand.slides} title={content.image.heading} />
          </div>
        )}
      </div>
    );
  }
  if (platform === "instagram") {
    return <InstagramPreview content={content} language={language} brand={brand} />;
  }
  return (
    <div className="rounded-lg bg-canvas p-4" lang={language} dir={dir}>
      {content.image && (
        <div className="mb-3">
          <ImageFrame image={content.image} language={language} brand={brand.slides} title={content.image.heading} />
        </div>
      )}
      {brand.articleUrl && (
        <p className="label break-all" dir="ltr">
          {brand.articleUrl.replace(/^https?:\/\//, "")}
        </p>
      )}
      <h3 className="mt-2 font-display text-2xl font-semibold leading-snug">{content.title}</h3>
      {content.excerpt && <p className="mt-2 text-ink-soft">{content.excerpt}</p>}
      <Markdown source={content.body} className="mt-4 !text-base" />
      {(content.tags ?? []).length > 0 && (
        <p className="label mt-4">{content.tags?.filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}
