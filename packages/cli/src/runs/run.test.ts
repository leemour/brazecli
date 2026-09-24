import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { findRun, listRuns, startRun } from "./run.js"

// The control character is the point: these assert that no ANSI escape reaches a machine
// stream or a log file.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the test
const ANSI = /\u001b\[/

const runsDir = () => mkdtempSync(join(tmpdir(), "brazecli-runs-"))

const start = (dir: string, overrides = {}) =>
  startRun({ runsDir: dir, command: "api GET /campaigns/list", profile: "staging", cliVersion: "0.0.0", ...overrides })

describe("a run directory", () => {
  it("exists from the first moment, with run.json already in it", () => {
    const run = start(runsDir())

    // Written at the start as well as at the end: a run killed mid-flight must still be findable.
    expect(existsSync(join(run.dir, "run.json"))).toBe(true)
    expect(JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")).status).toBe("running")
  })

  it("is named so it sorts by time and reads without opening", () => {
    const run = start(runsDir())

    expect(run.id).toMatch(/^\d{8}T\d{6}Z-api-get-campaigns-list-[0-9a-f]{6}$/)
  })

  it("finalizes with a status and a duration, and carries no key", async () => {
    const run = start(runsDir())

    await run.finish("success", { httpRequests: 1 })

    const metadata = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8"))
    expect(metadata.status).toBe("success")
    expect(metadata.httpRequests).toBe(1)
    expect(typeof metadata.durationMs).toBe("number")
  })

  it("records the audit trail at the default level, rather than leaving an empty file", async () => {
    const run = start(runsDir())
    // A log that is empty unless someone knew to set BRAZE_LOG=debug is not an audit trail.
    run.logger.info({ event: "http.response", status: 200 })
    await run.finish("success")

    const lines = readFileSync(join(run.dir, "events.jsonl"), "utf8").trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "").event).toBe("http.response")
  })

  it("redacts a credential that reached the logger anyway", async () => {
    const run = start(runsDir())
    run.logger.info({ event: "http.request", headers: { authorization: "Bearer secret-key" } })
    await run.finish("success")

    const log = readFileSync(join(run.dir, "events.jsonl"), "utf8")
    expect(log).toContain("[redacted]")
    expect(log).not.toContain("secret-key")
  })

  it("redacts BRAZE_API_KEY, which only braze knows is a secret", async () => {
    const run = start(runsDir())
    run.logger.info({ event: "env", env: { BRAZE_API_KEY: "secret-key" } })
    await run.finish("success")

    expect(readFileSync(join(run.dir, "events.jsonl"), "utf8")).not.toContain("secret-key")
  })

  it("warns once and carries on when its directory disappears mid-run", async () => {
    const warn = vi.fn()
    const run = start(runsDir(), { warn })
    rmSync(run.dir, { recursive: true })
    await new Promise((resolve) => setTimeout(resolve, 20))

    run.logger.info({ event: "http.response", status: 200 })
    await run.finish("success")

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain("events.jsonl")
  })

  it("keeps the whole log on disk after a failed run is closed", async () => {
    const run = start(runsDir())
    run.logger.info({ event: "first" })
    run.logger.info({ event: "last" })

    await run.finish("failed", { errorCode: "provider_error" })

    // An async destination would drop the tail here, which is precisely the case the log exists
    // for: the command that failed.
    const lines = readFileSync(join(run.dir, "events.jsonl"), "utf8").trim().split("\n")
    expect(JSON.parse(lines.at(-1) ?? "").event).toBe("last")
  })

  it("writes no ANSI into the log", async () => {
    const run = start(runsDir())
    run.logger.info({ event: "plain" })
    await run.finish("success")

    expect(readFileSync(join(run.dir, "events.jsonl"), "utf8")).not.toMatch(ANSI)
  })

  it("ignores a second finish rather than overwriting the first", async () => {
    const run = start(runsDir())
    await run.finish("success")
    await run.finish("failed")

    expect(JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")).status).toBe("success")
  })
})

describe("finding runs", () => {
  it("lists them newest first", async () => {
    const dir = runsDir()
    const first = start(dir, { runId: "20260913T100000Z-a-000001" })
    await first.finish("success")
    const second = start(dir, { runId: "20260913T110000Z-b-000002" })
    await second.finish("failed")

    expect(listRuns(dir).map((run) => run.runId)).toEqual([second.id, first.id])
  })

  it("finds one by id without knowing which day it is under", async () => {
    const dir = runsDir()
    const run = start(dir)
    await run.finish("success")

    expect(findRun(dir, run.id)?.dir).toBe(run.dir)
    expect(findRun(dir, "nope")).toBeUndefined()
  })
})
