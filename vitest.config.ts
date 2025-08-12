import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "./codemirror-ls/**/*.test.ts",
      "./ls-ws-server/**/*.test.ts",
    ],
    environment: "happy-dom",
  },
})