import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PieceContent } from "./db/schema";
import { StudioError } from "./errors";
import type { Language } from "./language";
import { readPhoto } from "./media";
import { IMAGE_SIZES, IMAGE_VERSION, imageHtml, type PostImage } from "./post-image";
import { SLIDE_SIZE, TEMPLATE_VERSION, slideHtml, type SlideBrand } from "./slides";

// Slides and post images are drawn by the Chrome already installed on this computer, which shapes
// right-to-left text correctly. Images are kept by their content, so downloading and posting reuse the same files.

const RENDER_DIR = () => path.resolve(/*turbopackIgnore: true*/ process.env.RENDER_DIR ?? ".data/renders");

const keyOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

async function photoData(name: string | undefined, missing: string): Promise<string | null> {
  if (!name) return null;
  const photo = await readPhoto(name);
  if (!photo) throw new StudioError(missing);
  return `data:${photo.type};base64,${photo.bytes.toString("base64")}`;
}

/** Draws each page at the given size as a JPEG, in one Chrome. */
async function drawPages(pages: string[], viewport: { width: number; height: number }): Promise<Buffer[]> {
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch(
      process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
    );
  } catch {
    throw new StudioError("The studio needs Google Chrome to make images. Install Chrome, or set CHROME_PATH in .env.local.");
  }
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const images: Buffer[] = [];
    for (const html of pages) {
      await page.setContent(html, { waitUntil: "networkidle", timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      images.push(await page.screenshot({ type: "jpeg", quality: 92 }));
    }
    return images;
  } finally {
    await browser.close();
  }
}

/** Reads the files when they were made before, or draws and keeps them. */
async function cached(files: string[], draw: () => Promise<Buffer[]>): Promise<Buffer[]> {
  try {
    return await Promise.all(files.map((file) => readFile(/*turbopackIgnore: true*/ file)));
  } catch {
    // Not made yet, so draw them below.
  }
  const images = await draw();
  await mkdir(/*turbopackIgnore: true*/ RENDER_DIR(), { recursive: true });
  await Promise.all(images.map((image, index) => writeFile(/*turbopackIgnore: true*/ files[index], image)));
  return images;
}

export async function renderSlides(content: PieceContent, language: Language, brand: SlideBrand): Promise<Buffer[]> {
  const slides = content.slides ?? [];
  if (slides.length === 0) throw new StudioError("This post has no slides.");
  const key = keyOf({ TEMPLATE_VERSION, language, slides, photo: content.photo ?? null, brand });
  const files = slides.map((_, index) => path.join(/*turbopackIgnore: true*/ RENDER_DIR(), `${key}-${index + 1}.jpg`));
  return cached(files, async () => {
    const photoSrc = await photoData(content.photo, "The cover photo is missing. Upload it again or remove it.");
    const pages = slides.map((slide, index) => slideHtml(slide, { index, total: slides.length, language, photoSrc, brand }));
    return drawPages(pages, SLIDE_SIZE);
  });
}

/** The brand image of a LinkedIn post or an article, as the JPEG that is posted. */
export async function renderPostImage(image: PostImage, language: Language, brand: SlideBrand): Promise<Buffer> {
  const key = keyOf({ IMAGE_VERSION, language, image, brand });
  const file = path.join(/*turbopackIgnore: true*/ RENDER_DIR(), `image-${key}.jpg`);
  const [jpeg] = await cached([file], async () => {
    const photoSrc = await photoData(image.photo, "The image's photo is missing. Upload it again or remove it.");
    return drawPages([imageHtml(image, { language, brand, photoSrc })], IMAGE_SIZES[image.size]);
  });
  return jpeg;
}
