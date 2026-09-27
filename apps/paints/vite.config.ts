import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the dev server on a fixed port and needs the build to land in dist/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
    watch: {
      // src-tauri is Rust; cargo watches it, vite should not.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome120",
    sourcemap: true,
  },
});
