import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The first in-memory database of a run loads Postgres as WASM, which can take over 10 seconds.
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000 },
});
