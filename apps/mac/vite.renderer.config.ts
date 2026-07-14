import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** approval window renderer. */
export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  build: {
    sourcemap: true,
  },
});
