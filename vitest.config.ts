import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Agents run suites side by side on 24 cores; one worker per core ran the machine out of memory (2026-10-11).
    maxWorkers: 4,
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    // No globals: core's tsconfig sets `types: []` to keep @types/node out, and injected
    // globals would need a types entry that reopens that door.
    globals: false,
  },
})
