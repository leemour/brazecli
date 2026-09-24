import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { beforeEach, describe, expect, it } from "vitest"
import { emptyConfig, saveConfig } from "../config/file.js"
import { run } from "../program.js"

let configDir: string
let streams: ReturnType<typeof captureStreams>

const configure = (expectMaxMonthlyActives?: number) => {
  const config = emptyConfig()
  config.profiles.staging = { restEndpoint: "https://rest.iad-01.braze.com", readOnly: false, expectMaxMonthlyActives }
  saveConfig(configDir, config)
}

const verify = (argv: string[], mau: number) =>
  run(["profile", "verify", ...argv], {
    env: { BRAZE_CONFIG_DIR: configDir, BRAZE_API_KEY: "k" },
    keyring: memoryKeyring(),
    streams,
    isTty: false,
    fetch: mockBraze(brazeResponses.ok({ data: [{ time: "2026-09-14", mau }], message: "success" })).fetch,
  })

const stored = () => JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).profiles.staging

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-verify-"))
  streams = captureStreams()
})

describe("braze profile verify", () => {
  it("reports the size and says nothing is being checked when no ceiling is recorded", async () => {
    configure()

    expect(await verify(["staging", "--json"], 502)).toBe(0)
    expect(JSON.parse(streams.stdout.join("\n"))).toMatchObject({ monthlyActives: 502, verdict: "unchecked" })
    expect(streams.stderr.join("\n")).toMatch(/--expect-max/)
  })

  it("passes when the workspace is within the recorded ceiling", async () => {
    configure(10000)

    expect(await verify(["staging", "--json"], 502)).toBe(0)
    expect(JSON.parse(streams.stdout.join("\n"))).toMatchObject({ verdict: "ok" })
  })

  // The incident this exists for: a key was swapped and the CLI went on reading a workspace with
  // 1.3 million monthly actives while everyone believed it was the sandbox.
  it("fails when the workspace is far larger than the profile expects", async () => {
    configure(10000)

    const code = await verify(["staging", "--json"], 1307224)

    expect(code).toBe(3)
    expect(streams.stderr.join("\n")).toMatch(/pointed at a different workspace/)
  })

  it("records a ceiling the workspace agrees with", async () => {
    configure()

    expect(await verify(["staging", "--expect-max", "10000", "--json"], 502)).toBe(0)
    expect(stored().expectMaxMonthlyActives).toBe(10000)
  })

  it("records NOTHING when the ceiling is already contradicted", async () => {
    configure()

    const code = await verify(["staging", "--expect-max", "10000", "--json"], 1307224)

    expect(code).toBe(3)
    // Saving here would write "this is the small workspace" onto the large one.
    expect(stored().expectMaxMonthlyActives).toBeUndefined()
  })
})
