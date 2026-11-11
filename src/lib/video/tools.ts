import { spawn } from "node:child_process";
import path from "node:path";
import { StudioError } from "../errors";

// FFmpeg does the cutting, framing, captions and sound. It's installed on this computer, not bundled.

export const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";

/** Where clips, finished videos and the speech model live, next to the database. */
export const DATA_DIR = () => path.resolve(/*turbopackIgnore: true*/ process.env.VIDEO_DATA_DIR ?? ".data");
export const FOOTAGE_DIR = () => path.join(/*turbopackIgnore: true*/ DATA_DIR(), "footage");
export const VIDEO_DIR = () => path.join(/*turbopackIgnore: true*/ DATA_DIR(), "videos");
export const MODEL_DIR = () => process.env.MODEL_DIR || path.join(/*turbopackIgnore: true*/ DATA_DIR(), "models");
export const FONT_DIR = () => path.resolve(/*turbopackIgnore: true*/ "assets/fonts");

const MISSING =
  "The studio needs FFmpeg to edit videos. Install it (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Linux: your package manager), then restart the studio. Or set FFMPEG_PATH and FFPROBE_PATH in .env.local.";

type RunOptions = { cwd?: string; onLine?: (line: string) => void; signal?: AbortSignal };

/** Runs a program and returns its output. Fails with the last lines it printed. */
export function run(command: string, args: string[], { cwd, onLine, signal }: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, signal });
    let out = "";
    let err = "";
    let partial = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      out += text;
      if (!onLine) return;
      partial += text;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      lines.forEach(onLine);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" && (command === FFMPEG() || command === FFPROBE()) ? new StudioError(MISSING) : error);
    });
    child.on("close", (code) => {
      if (partial && onLine) onLine(partial);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(command)} exited with ${code}: ${err.trim().split("\n").slice(-6).join("\n")}`));
    });
  });
}

export type Probe = { duration: number; width: number; height: number; hasAudio: boolean };

/** Reads a clip's length and picture size, turned the way it's meant to be watched. */
export async function probe(file: string): Promise<Probe> {
  const out = await run(FFPROBE(), [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height:stream_side_data=rotation:stream_tags=rotate",
    "-of", "json",
    file,
  ]);
  const info = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
  };
  const video = info.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(info.format?.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) {
    throw new StudioError("This file doesn't look like a video the studio can read. Try an MP4 or MOV file.");
  }
  const rotation = Math.abs(Number(video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0));
  const turned = rotation === 90 || rotation === 270;
  return {
    duration,
    width: turned ? video.height : video.width,
    height: turned ? video.width : video.height,
    hasAudio: Boolean(info.streams?.some((stream) => stream.codec_type === "audio")),
  };
}

/** Escapes a path for use inside an FFmpeg filter, such as the caption file and fonts folder. */
export function filterPath(file: string): string {
  return `'${file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`;
}

/** For the Connections page: whether this computer is ready to edit videos. */
export async function checkVideoTools(): Promise<{ ffmpeg: boolean; model: boolean; freeGb: number | null }> {
  const { stat, statfs } = await import("node:fs/promises");
  const ffmpeg = await run(FFMPEG(), ["-hide_banner", "-version"]).then(
    () => true,
    () => false,
  );
  const model = await stat(
    /*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MODEL_DIR(), "onnx-community", "whisper-large-v3-turbo_timestamped", "onnx", "encoder_model_quantized.onnx"),
  ).then(
    () => true,
    () => false,
  );
  const freeGb = await statfs(/*turbopackIgnore: true*/ path.resolve(/*turbopackIgnore: true*/ ".")).then(
    (stats) => (stats.bavail * stats.bsize) / 1024 ** 3,
    () => null,
  );
  return { ffmpeg, model, freeGb };
}
