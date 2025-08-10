import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@codemirror/state": path.resolve(
        __dirname,
        "node_modules/@codemirror/state",
      ),
      "@codemirror/view": path.resolve(
        __dirname,
        "node_modules/@codemirror/view",
      ),
      "@codemirror/language": path.resolve(
        __dirname,
        "node_modules/@codemirror/language",
      ),
      "@codemirror/commands": path.resolve(
        __dirname,
        "node_modules/@codemirror/commands",
      ),
      "@codemirror/autocomplete": path.resolve(
        __dirname,
        "node_modules/@codemirror/autocomplete",
      ),
      codemirror: path.resolve(__dirname, "node_modules/codemirror"),
    },
  },
  optimizeDeps: {
    include: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@codemirror/lint",
      "codemirror",
    ],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
