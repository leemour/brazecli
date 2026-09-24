import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring, captureStreams, type KeyringStore, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { keyringService } from "../auth/credentials.js"
import { run } from "../program.js"

const PROFILE = { restEndpoint: "https://rest.fra-01.braze.eu" }

const setup = (config?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "brazecli-doctor-"))
  const env: NodeJS.ProcessEnv = {
    BRAZE_CONFIG_DIR: join(dir, "config"),
    BRAZE_STATE_DIR: join(dir, "state"),
  }
  mkdirSync(env.BRAZE_CONFIG_DIR as string, { recursive: true })
  if (config !== undefined) writeFileSync(join(env.BRAZE_CONFIG_DIR as string, "config.json"), config)
  return env
}

const doctor = async (env: NodeJS.ProcessEnv, keyring: KeyringStore = memoryKeyring()) => {
  const streams = captureStreams()
  const fetch = () => Promise.reject(new Error("doctor reached the network"))
  const code = await run(["doctor", "--json"], { env, streams, keyring, fetch, isTty: false })
  return { code, report: JSON.parse(streams.stdout.join("\n")), stderr: streams.stderr }
}

describe("braze doctor", () => {
  it("reports a machine with nothing configured, and says what to do first", async () => {
    const { code, report } = await doctor(setup())

    expect(code).toBe(0)
    expect(report.config).toMatchObject({ found: false, valid: true })
    expect(report.profiles).toEqual([])
    expect(report.update).toEqual({ lastCheckedAt: null, latest: null, newer: false })
    expect(report.next.join("\n")).toContain("braze profile add")
  })

  it("reports an invalid config as data and still exits 0", async () => {
    const { code, report } = await doctor(setup("{ not json"))

    expect(code).toBe(0)
    expect(report.config).toMatchObject({
      found: true,
      valid: false,
      problem: expect.stringContaining("not valid JSON"),
    })
    expect(report.next[0]).toContain("fix or move")
  })

  it("says where each profile's key comes from, and never what it is", async () => {
    const env = setup(JSON.stringify({ version: 1, profiles: { staging: PROFILE, production: PROFILE } }))
    const service = keyringService(env.BRAZE_CONFIG_DIR as string, env)
    const keyring = memoryKeyring({ [`${service}:staging`]: "the-secret-key" })

    const { report, stderr } = await doctor(env, keyring)

    expect(report.profiles).toEqual([
      {
        name: "staging",
        restEndpoint: PROFILE.restEndpoint,
        readOnly: false,
        apiKey: { present: true, source: "keyring" },
      },
      { name: "production", restEndpoint: PROFILE.restEndpoint, readOnly: false, apiKey: { present: false } },
    ])
    expect(report.next.join("\n")).toContain('profile "production" has no key')
    expect(JSON.stringify(report) + stderr.join("")).not.toContain("the-secret-key")
  })

  it("says the keyring is isolated when BRAZE_CONFIG_DIR is set", async () => {
    const env = setup()
    const { report } = await doctor(env)

    expect(report.keyring).toEqual({ service: `brazecli:${env.BRAZE_CONFIG_DIR}`, isolated: true })
  })

  it("reports a pinned keyring that will not open as that profile's problem, not a crash", async () => {
    const env = setup(JSON.stringify({ version: 1, credentialStorage: "keyring", profiles: { staging: PROFILE } }))

    const { code, report } = await doctor(env, brokenKeyring())

    expect(code).toBe(0)
    expect(report.profiles[0].apiKey).toMatchObject({ present: false, problem: expect.stringContaining("keyring") })
  })

  it("reads the last npm answer from the state file without asking npm", async () => {
    const env = setup()
    mkdirSync(env.BRAZE_STATE_DIR as string, { recursive: true })
    writeFileSync(
      join(env.BRAZE_STATE_DIR as string, "update-check.json"),
      JSON.stringify({ checkedAt: Date.parse("2026-09-24T10:00:00Z"), latest: "99.0.0" }),
    )

    const { report } = await doctor(env)

    expect(report.update).toEqual({ lastCheckedAt: "2026-09-24T10:00:00.000Z", latest: "99.0.0", newer: true })
    expect(report.next.join("\n")).toContain("braze update")
  })

  it("gives a person lines to read rather than JSON", async () => {
    const streams = captureStreams()
    const code = await run(["doctor"], { env: setup(), streams, keyring: memoryKeyring(), isTty: true })
    const text = streams.stdout.join("\n")

    expect(code).toBe(0)
    expect(text).toMatch(/^braze {5}/)
    expect(text).toContain("profiles  none")
    expect(text).not.toContain("{")
  })
})
