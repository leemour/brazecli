import { join } from "node:path"
import envPaths from "env-paths"
import { describe, expect, it } from "vitest"
import { resolvePaths } from "./paths.js"

// What braze resolved before it took its directories from cli-core. A different answer here moves
// config.json away from its profiles, or runs/ away from everything `braze runs list` has recorded.
const before = envPaths("brazecli", { suffix: "" })

describe("resolvePaths", () => {
  it("keeps config and runs where they were", () => {
    const paths = resolvePaths({})

    expect(paths.config).toBe(before.config)
    expect(paths.runs).toBe(join(before.data, "runs"))
  })

  it("honours BRAZE_CONFIG_DIR and BRAZE_RUNS_DIR", () => {
    const paths = resolvePaths({ BRAZE_CONFIG_DIR: "/tmp/c", BRAZE_RUNS_DIR: "/tmp/r" })

    expect(paths).toMatchObject({ config: "/tmp/c", runs: "/tmp/r" })
  })

  it("keeps runs in place when only the config directory moves", () => {
    expect(resolvePaths({ BRAZE_CONFIG_DIR: "/tmp/c" }).runs).toBe(join(before.data, "runs"))
  })
})
