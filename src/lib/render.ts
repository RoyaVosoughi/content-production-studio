import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PieceContent } from "./db/schema";
import { StudioError } from "./errors";
import type { Language } from "./language";
import { readPhoto } from "./media";
import { SLIDE_SIZE, TEMPLATE_VERSION, slideHtml, type SlideBrand } from "./slides";

// Slides are drawn by the Chrome already installed on this computer, which shapes right-to-left text
// correctly. Images are kept by their content, so downloading and posting reuse the same files.

const RENDER_DIR = () => path.resolve(/*turbopackIgnore: true*/ process.env.RENDER_DIR ?? ".data/renders");

export async function renderSlides(content: PieceContent, language: Language, brand: SlideBrand): Promise<Buffer[]> {
  const slides = content.slides ?? [];
  if (slides.length === 0) throw new StudioError("This post has no slides.");
  const key = createHash("sha256")
    .update(JSON.stringify({ TEMPLATE_VERSION, language, slides, photo: content.photo ?? null, brand }))
    .digest("hex")
    .slice(0, 24);
  const files = slides.map((_, index) => path.join(/*turbopackIgnore: true*/ RENDER_DIR(), `${key}-${index + 1}.jpg`));

  try {
    return await Promise.all(files.map((file) => readFile(/*turbopackIgnore: true*/ file)));
  } catch {
    // Not made yet, so draw them below.
  }

  const photo = content.photo ? await readPhoto(content.photo) : null;
  if (content.photo && !photo) throw new StudioError("The cover photo is missing. Upload it again or remove it.");
  const photoSrc = photo ? `data:${photo.type};base64,${photo.bytes.toString("base64")}` : null;

  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch(
      process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
    );
  } catch {
    throw new StudioError("The studio needs Google Chrome to make the slide images. Install Chrome, or set CHROME_PATH in .env.local.");
  }
  try {
    const page = await browser.newPage({ viewport: SLIDE_SIZE, deviceScaleFactor: 1 });
    const images: Buffer[] = [];
    for (const [index, slide] of slides.entries()) {
      await page.setContent(slideHtml(slide, { index, total: slides.length, language, photoSrc, brand }), {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      await page.evaluate(() => document.fonts.ready);
      images.push(await page.screenshot({ type: "jpeg", quality: 92 }));
    }
    await mkdir(/*turbopackIgnore: true*/ RENDER_DIR(), { recursive: true });
    await Promise.all(images.map((image, index) => writeFile(/*turbopackIgnore: true*/ files[index], image)));
    return images;
  } finally {
    await browser.close();
  }
}
