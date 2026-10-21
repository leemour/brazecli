import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { emptyConfig, saveConfig } from "../config/file.js"
import { run } from "../program.js"

let configDir: string
let runsDir: string
let streams: ReturnType<typeof captureStreams>
const originalTz = process.env.TZ

const braze = (argv: string[], mock = mockBraze(brazeResponses.ok({ data: [] })), isTty = false) => {
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.iad-01.braze.com", readOnly: false }
  saveConfig(configDir, config)

  return run(argv, {
    env: {
      BRAZE_CONFIG_DIR: configDir,
      BRAZE_RUNS_DIR: runsDir,
      BRAZE_API_KEY: "test-key",
      BRAZE_PROFILE: "production",
    },
    keyring: memoryKeyring(),
    streams,
    isTty,
    fetch: mock.fetch,
  })
}

const sentQuery = (mock: ReturnType<typeof mockBraze>) =>
  Object.fromEntries(new URL(mock.requests[0]?.url as string).searchParams)

const lastRunDir = (): string => {
  const day = readdirSync(runsDir).sort().at(-1) as string
  const id = readdirSync(join(runsDir, day)).sort().at(-1) as string
  return join(runsDir, day, id)
}

const stored = () => {
  const dir = lastRunDir()
  const meta = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Record<string, unknown>
  const events = readFileSync(join(dir, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { meta, resolved: events.find((event) => event.event === "times_resolved") }
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-tz-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-tzruns-"))
  streams = captureStreams()
})

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe("typed times without a zone", () => {
  it("are read in --timezone, sent as UTC, and the zone is named on stderr", async () => {
    const mock = mockBraze(brazeResponses.ok({ data: [] }))

    const code = await braze(
      [
        "kpi",
        "dau",
        "data-series",
        "--length",
        "7",
        "--ending-at",
        "2026-09-01",
        "--timezone",
        "Europe/Madrid",
        "--json",
      ],
      mock,
    )

    expect(code).toBe(0)
    expect(sentQuery(mock).ending_at).toBe("2026-09-01T21:59:59Z")
    expect(streams.stderr.join("\n")).toContain("times read in Europe/Madrid")
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({ data: [] })
  })

  it("fall back to this computer's zone, and say so", async () => {
    process.env.TZ = "Asia/Vladivostok"
    const mock = mockBraze(brazeResponses.ok({ data: [] }))

    await braze(["kpi", "dau", "data-series", "--length", "7", "--ending-at", "2026-09-01T10:00", "--json"], mock)

    expect(sentQuery(mock).ending_at).toBe("2026-09-01T00:00:00Z")
    expect(streams.stderr.join("\n")).toContain("times read in Asia/Vladivostok")
  })

  it("show the zone and the UTC value in a dry run's plan", async () => {
    const code = await braze([
      "email",
      "hard-bounces",
      "--start-date",
      "2026-09-01",
      "--end-date",
      "2026-09-02",
      "--timezone",
      "America/Los_Angeles",
      "--dry-run",
      "--json",
    ])
    const plan = JSON.parse(streams.stdout.join("\n"))

    expect(code).toBe(0)
    expect(plan.timezone).toBe("America/Los_Angeles")
    expect(plan.query).toMatchObject({ start_date: "2026-09-01", end_date: "2026-09-02" })
    expect(plan.times[0].means).toContain("UTC day")
  })

  it("refuse a --timezone that is not an IANA zone", async () => {
    const mock = mockBraze(brazeResponses.ok({}))

    expect(await braze(["campaigns", "list", "--timezone", "Mars/Olympus", "--json"], mock)).toBe(2)
    expect(mock.requests).toHaveLength(0)
  })

  it("send and store the same UTC values whatever zone the computer is in, given --timezone", async () => {
    const argv = [
      "campaigns",
      "data-series",
      "--campaign-id",
      "c1",
      "--length",
      "7",
      "--ending-at",
      "2026-09-01T10:00",
      "--timezone",
      "Europe/Madrid",
      "--json",
    ]
    const results = []

    for (const tz of ["Asia/Vladivostok", "America/Los_Angeles"]) {
      process.env.TZ = tz
      runsDir = mkdtempSync(join(tmpdir(), "brazecli-tzruns-"))
      const mock = mockBraze(brazeResponses.ok({ data: [] }))

      await braze(argv, mock)
      const { meta, resolved } = stored()
      results.push({
        sent: sentQuery(mock),
        resolved: { timeZone: resolved?.timeZone, conversions: resolved?.conversions },
      })
      expect(meta.startedAt).toMatch(/Z$/)
    }

    expect(results[0]?.sent.ending_at).toBe("2026-09-01T08:00:00Z")
    expect(results[1]).toEqual(results[0])
  })
})

describe("times shown to a person", () => {
  const runAt = (startedAt: string) => {
    const dir = join(runsDir, startedAt.slice(0, 10), "r1")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        runId: "r1",
        command: "campaigns list",
        profile: "t",
        startedAt,
        status: "success",
        cliVersion: "0",
      }),
    )
  }

  it("are in the zone in use, named, in pretty output", async () => {
    runAt("2026-09-13T19:15:00.000Z")

    await braze(["runs", "list", "--output", "pretty", "--timezone", "Europe/Madrid"], undefined, true)

    expect(streams.stdout.join("\n")).toContain("2026-09-13 21:15:00 Europe/Madrid")
  })

  it("stay UTC in JSON", async () => {
    runAt("2026-09-13T19:15:00.000Z")

    await braze(["runs", "list", "--json", "--timezone", "Europe/Madrid"])

    expect(JSON.parse(streams.stdout.join("\n"))[0].startedAt).toBe("2026-09-13T19:15:00.000Z")
  })
})
