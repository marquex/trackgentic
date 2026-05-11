import { defineConfig } from "tsup";

export default defineConfig([
  // Library build — ESM + CJS + type declarations
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node20",
    outDir: "dist",
    // Don't bundle — keep external imports (commander) as peer deps
    // This allows tree-shaking for library consumers
    noExternal: [],
    external: ["commander"],
  },
  // CLI binary build — standalone bundle with node shebang
  {
    entry: ["src/bin.ts"],
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    clean: false, // don't clean dist/ (library build already did)
    target: "node20",
    outDir: "dist",
    // Bundle everything including commander into the standalone binary
    bundle: true,
    // Rename output to bin.js for clarity
    outExtension: () => ({ js: ".js" }),
  },
]);
