import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { beforeEach, describe, expect, it } from "vitest"
import { emptyConfig, saveConfig } from "../config/file.js"
import { run } from "../program.js"
import { listRuns } from "../runs/run.js"

let configDir: string
let runsDir: string
let streams: ReturnType<typeof captureStreams>
let keyring: ReturnType<typeof memoryKeyring>

const configure = (readOnly: boolean) => {
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.iad-01.braze.com", readOnly }
  saveConfig(configDir, config)
}

const braze = (argv: string[], braze: ReturnType<typeof mockBraze>) =>
  run(argv, {
    env: {
      BRAZE_CONFIG_DIR: configDir,
      BRAZE_RUNS_DIR: runsDir,
      BRAZE_API_KEY: "test-key",
      BRAZE_PROFILE: "production",
    },
    keyring,
    streams,
    isTty: false,
    fetch: braze.fetch,
  })

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-api-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-apiruns-"))
  streams = captureStreams()
  keyring = memoryKeyring()
  configure(false)
})

describe("braze api", () => {
  it("sends a read and puts only the data on stdout", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [{ id: "c1" }] }))

    const code = await braze(["api", "GET", "/campaigns/list", "--query", "page=0"], mock)

    expect(code).toBe(0)
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({ campaigns: [{ id: "c1" }] })
    expect(mock.lastRequest().path).toBe("/campaigns/list")
    expect(mock.lastRequest().query.get("page")).toBe("0")
  })

  it("identifies itself without saying anything about the machine", async () => {
    const mock = mockBraze(brazeResponses.ok())

    await braze(["api", "GET", "/campaigns/list"], mock)

    expect(mock.lastRequest().headers.get("user-agent")).toMatch(/^brazecli\/\d+\.\d+\.\d+ runtime\/node platform\//)
  })

  it("refuses a write without --confirm and sends nothing", async () => {
    const mock = mockBraze(brazeResponses.created())

    const code = await braze(["api", "POST", "/users/track", "--input", '{"attributes":[]}'], mock)

    expect(code).toBe(7)
    expect(streams.stderr.join("\n")).toMatch(/confirmation_required/)
    expect(mock.requests).toHaveLength(0)
  })

  it("sends a write once --confirm is there", async () => {
    const mock = mockBraze(brazeResponses.created({ message: "success" }))

    const code = await braze(["api", "POST", "/users/track", "--input", '{"attributes":[]}', "--confirm"], mock)

    expect(code).toBe(0)
    expect(mock.requests).toHaveLength(1)
  })

  describe("a read-only profile", () => {
    beforeEach(() => {
      configure(true)
    })

    it("refuses a write even when --confirm is given", async () => {
      const mock = mockBraze(brazeResponses.created())

      const code = await braze(["api", "POST", "/users/track", "--input", "{}", "--confirm"], mock)

      // --confirm guards against a typo; this guards against a correct command aimed at the
      // wrong environment, so it has to win over --confirm rather than sit behind it.
      expect(code).toBe(5)
      expect(streams.stderr.join("\n")).toMatch(/marked read-only/)
      expect(mock.requests).toHaveLength(0)
    })

    // FIND-13. Before the catalog carried this endpoint, `braze api` judged by HTTP method, so a
    // read Braze implements as a POST was refused here and there was no way to run it at all.
    it("allows a read that Braze implements as a POST, because the catalog says it is a read", async () => {
      const mock = mockBraze(brazeResponses.created())

      const code = await braze(["api", "POST", "/users/export/ids", "--input", '{"external_ids":[]}'], mock)

      expect(code).toBe(0)
      expect(mock.requests).toHaveLength(1)
    })

    it("still refuses a POST the catalog agrees is a write", async () => {
      const mock = mockBraze(brazeResponses.created())

      expect(await braze(["api", "POST", "/users/track", "--input", "{}", "--confirm"], mock)).toBe(5)
      expect(mock.requests).toHaveLength(0)
    })

    it("still allows reads", async () => {
      const mock = mockBraze(brazeResponses.ok({ campaigns: [] }))

      expect(await braze(["api", "GET", "/campaigns/list"], mock)).toBe(0)
      expect(mock.requests).toHaveLength(1)
    })

    it("still allows a dry run, which is the tool you want most when locked down", async () => {
      const mock = mockBraze(brazeResponses.created())

      const code = await braze(["api", "POST", "/users/track", "--input", "{}", "--dry-run"], mock)

      expect(code).toBe(0)
      expect(mock.requests).toHaveLength(0)
      expect(JSON.parse(streams.stdout.join("\n"))).toMatchObject({ dryRun: true, access: "write" })
    })
  })

  describe("run artifacts", () => {
    it("records a successful run", async () => {
      await braze(["api", "GET", "/campaigns/list"], mockBraze(brazeResponses.ok()))

      const runs = listRuns(runsDir)
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ status: "success", command: "api GET /campaigns/list", profile: "production" })
    })

    it("records a failed run too, rather than leaving a directory with no run.json", async () => {
      const code = await braze(["api", "GET", "/campaigns/list"], mockBraze(brazeResponses.unauthorized()))

      expect(code).toBe(4)
      expect(listRuns(runsDir)[0]).toMatchObject({ status: "failed", errorCode: "authentication_error" })
    })

    it("never writes the key into an artifact", async () => {
      await braze(["api", "GET", "/campaigns/list"], mockBraze(brazeResponses.ok()))

      const dir = listRuns(runsDir)[0]
      expect(dir).toBeDefined()
      const files = [join(runsDir, dir?.startedAt.slice(0, 10) ?? "", dir?.runId ?? "", "run.json")]
      for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("test-key")
    })
  })

  it("refuses a method Braze has no use for, before resolving anything", async () => {
    const mock = mockBraze(brazeResponses.ok())

    expect(await braze(["api", "TRACE", "/campaigns/list"], mock)).toBe(2)
    expect(mock.requests).toHaveLength(0)
  })
})
