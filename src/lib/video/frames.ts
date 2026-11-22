import { spawn } from "node:child_process";
import { StudioError } from "../errors";
import { FFMPEG } from "./tools";

// Draws a page that can show any moment on demand (window.seek) into a video: Chrome takes a picture
// of each frame and FFmpeg joins them. Used for animations and for the explainers over a clip.

export const FPS = 30;

export type DrawFrames = (input: {
  html: string;
  width: number;
  height: number;
  duration: number;
  audio: string | null;
  out: string;
  onProgress: (progress: number) => void;
}) => Promise<void>;

/**
 * Chrome shows each moment of the page in turn and takes a picture of it; FFmpeg joins the pictures
 * into a video, with the narration or silence underneath.
 */
export const chromeFrames: DrawFrames = async ({ html, width, height, duration, audio, out, onProgress }) => {
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  } catch {
    throw new StudioError("The studio needs Google Chrome to draw animations. Install Chrome, or set CHROME_PATH in .env.local.");
  }
  const sound = audio ? ["-i", audio] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  const ffmpeg = spawn(
    FFMPEG(),
    [
      "-hide_banner", "-nostats", "-y",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      ...sound,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-af", "apad", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      "-t", duration.toFixed(3),
      "-movflags", "+faststart",
      out,
    ],
    { windowsHide: true },
  );
  let log = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-3000);
  });
  const finished = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? new StudioError("The studio needs FFmpeg to make videos. Install it, then restart the studio.") : error),
    );
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${log.trim().split("\n").slice(-5).join("\n")}`))));
  });
  // Without this, a failed FFmpeg would make the writes below throw instead of reporting why.
  ffmpeg.stdin.on("error", () => {});
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const frames = Math.ceil(duration * FPS);
    for (let frame = 0; frame < frames; frame++) {
      if (ffmpeg.exitCode !== null) break;
      await page.evaluate((t) => (window as unknown as { seek: (t: number) => void }).seek(t), frame / FPS);
      const shot = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ffmpeg.stdin.write(shot)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if (frame % 15 === 0) onProgress(frame / frames);
    }
    ffmpeg.stdin.end();
    await finished;
  } catch (error) {
    ffmpeg.kill("SIGKILL");
    await finished.catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
};
