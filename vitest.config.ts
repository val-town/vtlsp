import { defineConfig } from "vitest/config"
import * as path from "node:path"

export default defineConfig({
  test: {
    include: [
      "./codemirror-ls/**/*.test.ts",
      "./ls-ws-server/**/*.test.ts",
    ],
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, "ls-ws-server", "src"),
    },
  },
})
