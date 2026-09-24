import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { keyringService } from "./auth/credentials.js"
import { emptyConfig, saveConfig } from "./config/file.js"
import { resolveColor, resolveOutputFormat, resolveSettings } from "./settings.js"

const configured = () => {
  const dir = mkdtempSync(join(tmpdir(), "brazecli-settings-"))
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.fra-01.braze.eu", readOnly: false }
  config.profiles.staging = { restEndpoint: "https://rest.iad-03.braze.com", readOnly: false }
  saveConfig(dir, config)
  return dir
}

// The keyring service is scoped to the config directory whenever BRAZE_CONFIG_DIR is set, which
// is what stops a throwaway directory from overwriting the real key for a profile.
const keyring = (dir: string) => {
  const service = keyringService(dir, { BRAZE_CONFIG_DIR: dir })
  return memoryKeyring({ [`${service}:production`]: "prod-key", [`${service}:staging`]: "staging-key" })
}

const settings = (flags = {}, env: NodeJS.ProcessEnv = {}) => {
  const dir = configured()
  return resolveSettings(flags, {
    env: { BRAZE_CONFIG_DIR: dir, ...env },
    keyring: keyring(dir),
    isTty: false,
    warn: () => {},
  })
}

describe("which profile", () => {
  it("takes --profile over everything", () => {
    expect(settings({ profile: "staging" }, { BRAZE_PROFILE: "production" }).profileName).toBe("staging")
  })

  it("then BRAZE_PROFILE", () => {
    expect(settings({}, { BRAZE_PROFILE: "staging" }).profileName).toBe("staging")
  })

  // NEED-25: there is no default. A default is chosen by omission, and the easiest thing to omit
  // must not be the workspace with a million people in it.
  it("refuses to guess when neither is given, and names the profiles that exist", () => {
    expect(() => settings()).toThrow(/no profile given/)
    expect(() => settings()).toThrow(/production/)
  })

  it("says what to run when the named profile does not exist", () => {
    expect(() => settings({ profile: "nope" })).toThrow(/braze profile list/)
  })
})

describe("endpoint and key", () => {
  it("lets the environment override the configured endpoint", () => {
    expect(
      settings({ profile: "production" }, { BRAZE_REST_ENDPOINT: "https://rest.example.braze.eu" }).restEndpoint,
    ).toBe("https://rest.example.braze.eu")
  })

  it("reports where the key came from, so a surprise is visible", () => {
    expect(settings({ profile: "production" }).apiKeySource).toBe("keyring")
    expect(settings({ profile: "production" }, { BRAZE_API_KEY: "override" }).apiKeySource).toBe("environment")
  })

  it("says what to run when there is no key at all", () => {
    expect(() =>
      resolveSettings(
        { profile: "production" },
        { env: { BRAZE_CONFIG_DIR: configured() }, keyring: memoryKeyring(), isTty: false, warn: () => {} },
      ),
    ).toThrow(/braze profile add production/)
  })
})

describe("output format — NEED-1", () => {
  const config = emptyConfig()

  it("gives a terminal the human renderer and a pipe JSON", () => {
    expect(resolveOutputFormat({}, {}, config, true)).toBe("pretty")
    expect(resolveOutputFormat({}, {}, config, false)).toBe("json")
  })

  it("lets --json win over a terminal", () => {
    expect(resolveOutputFormat({ json: true }, {}, config, true)).toBe("json")
  })

  it("honours BRAZE_OUTPUT", () => {
    expect(resolveOutputFormat({}, { BRAZE_OUTPUT: "jsonl" }, config, true)).toBe("jsonl")
  })

  it("puts the flag above the environment", () => {
    expect(resolveOutputFormat({ output: "pretty" }, { BRAZE_OUTPUT: "json" }, config, false)).toBe("pretty")
  })
})

describe("colour", () => {
  const config = emptyConfig()

  it("follows the terminal by default", () => {
    expect(resolveColor({}, {}, config, true)).toBe(true)
    expect(resolveColor({}, {}, config, false)).toBe(false)
  })

  it("obeys --no-color and NO_COLOR", () => {
    expect(resolveColor({ color: false }, {}, config, true)).toBe(false)
    expect(resolveColor({}, { NO_COLOR: "1" }, config, true)).toBe(false)
  })

  it("obeys FORCE_COLOR when nothing refuses first", () => {
    expect(resolveColor({}, { FORCE_COLOR: "1" }, config, false)).toBe(true)
  })
})
