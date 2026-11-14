import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // The first in-memory database of a run loads Postgres as WASM, which can take over 10 seconds.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Code that opens "the" database, such as the AI request counter, must never open the real one in
    // .data, which the running studio holds. Tests get a throwaway folder instead.
    env: { PGLITE_DIR: mkdtempSync(join(tmpdir(), "studio-test-db-")) },
  },
});
