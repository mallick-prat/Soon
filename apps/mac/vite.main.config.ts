import { defineConfig } from "vite";

/** main process bundle — node/electron target, native deps external. */
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron", "better-sqlite3", "@spectrum-ts/imessage-local", "spectrum-ts"],
    },
    sourcemap: true,
  },
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
});
