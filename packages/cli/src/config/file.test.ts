import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrazeError } from "brazecli-core"
import { describe, expect, it } from "vitest"
import { emptyConfig, loadConfig, saveConfig } from "./file.js"

const tempDir = () => mkdtempSync(join(tmpdir(), "brazecli-test-"))

describe("config file", () => {
  it("is an empty config when there is no file yet", () => {
    const config = loadConfig(join(tempDir(), "nothing"))

    expect(config.version).toBe(1)
    expect(config.profiles).toEqual({})
    expect(config.credentialStorage).toBe("auto")
  })

  it("round-trips what was saved", () => {
    const dir = tempDir()
    const config = emptyConfig()
    config.profiles.production = { restEndpoint: "https://rest.fra-01.braze.eu", readOnly: true }

    saveConfig(dir, config)

    expect(loadConfig(dir).profiles.production?.restEndpoint).toBe("https://rest.fra-01.braze.eu")
    expect(loadConfig(dir).profiles.production?.readOnly).toBe(true)
  })

  it("names the field when the file is not a valid config", () => {
    const dir = tempDir()
    writeFileSync(join(dir, "config.json"), JSON.stringify({ version: 1, profiles: { p: {} } }))

    expect(() => loadConfig(dir)).toThrow(/profiles\.p\.restEndpoint/)
  })

  it("says so plainly when the file is not JSON at all", () => {
    const dir = tempDir()
    writeFileSync(join(dir, "config.json"), "{ not json")

    expect(() => loadConfig(dir)).toThrow(/not valid JSON/)
  })

  // docs/agents.md publishes `3 → configuration_error` as a contract; a plain Error reaches the
  // agent as exit 1, which is the code for "we have no idea what happened".
  it.each([
    ["not JSON at all", "{ not json"],
    ["JSON that is not a config", JSON.stringify({ version: 1, profiles: { p: {} } })],
  ])("gives a broken config file its own exit code — %s", (_name, contents) => {
    const dir = tempDir()
    writeFileSync(join(dir, "config.json"), contents)

    expect(() => loadConfig(dir)).toThrow(BrazeError)
    try {
      loadConfig(dir)
    } catch (error) {
      expect((error as BrazeError).code).toBe("configuration_error")
    }
  })
})
