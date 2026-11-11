import type { NextConfig } from "next";

const config: NextConfig = {
  // The development badge would sit on top of the side menu.
  devIndicators: false,
  // PGlite loads a WASM build of Postgres at runtime, so it must not be bundled.
  // playwright-core drives the installed Chrome to draw slide images, so it must not be bundled either.
  // unpdf and mammoth read uploaded brand files on the server only, so they load from node_modules as they are.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "playwright-core", "unpdf", "mammoth"],
  // Cover photos are uploaded through a server action, which allows 1 MB by default.
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
};

export default config;
