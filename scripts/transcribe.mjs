// Turns speech into words with timings, using Whisper on this computer. No audio leaves it.
// The studio runs this as a separate process so a long transcription never slows the app.
//
// node scripts/transcribe.mjs <audio.f32> <language> <model folder> <windows JSON>
//   audio.f32: 16 kHz mono 32-bit float samples, as made by FFmpeg
//   windows: [[start, end], ...] in seconds. Whisper hears up to 30 seconds at a time, and its own
//   splitting loses words in Persian, so the studio splits the audio at pauses instead.
// Prints one JSON object per line: {"type":"download","progress":0.4}, {"type":"progress","progress":0.5},
// and finally {"type":"done","words":[{"text","start","end"}]}.

import { readFileSync } from "node:fs";
import { env, pipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-large-v3-turbo_timestamped";
const RATE = 16000;

const [audioFile, language, modelDir, windowsJson] = process.argv.slice(2);
const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

env.cacheDir = modelDir;
const bytes = readFileSync(audioFile);
const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
const windows = JSON.parse(windowsJson);

// The model is about 1.1 GB and downloads once, the first time.
const files = new Map();
const asr = await pipeline("automatic-speech-recognition", MODEL, {
  dtype: "q8",
  progress_callback: (event) => {
    if (event.status !== "progress" || !event.total) return;
    files.set(event.file, { loaded: event.loaded, total: event.total });
    const all = [...files.values()];
    const loaded = all.reduce((sum, file) => sum + file.loaded, 0);
    const total = all.reduce((sum, file) => sum + file.total, 0);
    say({ type: "download", progress: total ? loaded / total : 0 });
  },
});

const words = [];
for (const [index, [start, end]] of windows.entries()) {
  const audio = samples.subarray(Math.floor(start * RATE), Math.ceil(end * RATE));
  if (audio.length < RATE * 0.3) continue;
  const result = await asr(audio, { return_timestamps: "word", language, task: "transcribe" });
  for (const chunk of result.chunks ?? []) {
    const [from, to] = chunk.timestamp;
    const text = chunk.text.trim();
    if (!text || from === null) continue;
    words.push({ text, start: start + from, end: start + (to ?? from) });
  }
  say({ type: "progress", progress: (index + 1) / windows.length });
}
say({ type: "done", words });
