import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "codemirror-ls": path.resolve(__dirname, "../codemirror-ls/src/index.ts"),
      '@codemirror/state': path.resolve(__dirname, 'node_modules/@codemirror/state')
    },
  },
});
