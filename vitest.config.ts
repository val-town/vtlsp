import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    exclude: [],
    environment: "happy-dom",
  },
})