// Starts the studio on its own demo database, filled with sample data, so you can show every page
// without touching your own work in .data. `npm run demo -- --fresh` throws the demo away first and
// starts again from new sample data, dated from today.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const demo = path.join(root, ".data", "demo");

if (process.argv.includes("--fresh")) {
  rmSync(demo, { recursive: true, force: true });
  console.log("Removed the old demo. Starting a fresh one.");
}

const env = {
  ...process.env,
  STUDIO_DEMO: "1",
  PGLITE_DIR: path.join(demo, "pglite"),
  MEDIA_DIR: path.join(demo, "media"),
  RENDER_DIR: path.join(demo, "renders"),
  VIDEO_DATA_DIR: demo,
  // The speech model is the same for both, so the demo doesn't download it again.
  MODEL_DIR: process.env.MODEL_DIR || path.join(root, ".data", "models"),
};

// `npm run demo -- --port 3003` runs it next to a studio that already uses 3002.
const portAt = process.argv.indexOf("--port");
const port = portAt > 0 ? process.argv[portAt + 1] : "3002";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", port], { cwd: root, env, stdio: "inherit" });
// Ctrl+C reaches the studio too; wait for it to close its database before this one ends.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {});
child.on("exit", (code) => process.exit(code ?? 0));
