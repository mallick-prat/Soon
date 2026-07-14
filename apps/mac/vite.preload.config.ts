import { defineConfig } from "vite";

/** preload bundle — electron sandbox-compatible. */
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron"],
    },
    sourcemap: true,
  },
});
