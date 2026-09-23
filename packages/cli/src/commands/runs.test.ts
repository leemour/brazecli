import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrazeError } from "brazecli-core"
import { beforeEach, describe, expect, it } from "vitest"
import { captureStreams } from "../output/stream.js"
import { runsCommand } from "./runs.js"

let runsDir: string

const day = (offsetDays: number) => new Date(Date.now() - offsetDays * 86_400_000)

const makeRun = (id: string, ageDays: number) => {
  const startedAt = day(ageDays)
  const dir = join(runsDir, startedAt.toISOString().slice(0, 10), id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "run.json"),
    JSON.stringify({
      runId: id,
      command: "campaigns list",
      profile: "t",
      startedAt: startedAt.toISOString(),
      status: "success",
      cliVersion: "0.1.1",
    }),
  )
  writeFileSync(join(dir, "events.jsonl"), '{"msg":"x"}\n')
  return dir
}

const run = async (args: string[]) => {
  const streams = captureStreams()
  const command = runsCommand({ streams, env: { BRAZE_RUNS_DIR: runsDir }, isTty: false })
  // `setup` reads --runs-dir off the parent; the environment variable is the seam a test has.
  await command.parseAsync(args, { from: "user" })
  return { streams, result: JSON.parse(streams.stdout.join("\n")) as Record<string, unknown> }
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-cleanup-"))
})

// NEED-3: nothing expires on a timer. A run's records.csv is the only evidence an operation
// happened, so every removal is asked for, with the age named.
describe("runs cleanup", () => {
  it("removes nothing without --confirm, and says how much it would have removed", async () => {
    const old = makeRun("old-run", 30)

    await expect(run(["cleanup", "--older-than", "7"])).rejects.toThrow(BrazeError)
    expect(existsSync(old)).toBe(true)
  })

  it("lists what would go under --dry-run and leaves it there", async () => {
    const old = makeRun("old-run", 30)
    makeRun("fresh-run", 1)

    const { result } = await run(["cleanup", "--older-than", "7", "--dry-run"])

    expect(result).toMatchObject({ dryRun: true, count: 1 })
    expect(result.runs).toMatchObject([{ runId: "old-run" }])
    expect(existsSync(old)).toBe(true)
  })

  it("removes only what is older than the age given", async () => {
    const old = makeRun("old-run", 30)
    const fresh = makeRun("fresh-run", 1)

    const { result } = await run(["cleanup", "--older-than", "7", "--confirm"])

    expect(result).toMatchObject({ removed: 1 })
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it("takes the day directory with the last run in it", async () => {
    const dir = makeRun("old-run", 30)

    await run(["cleanup", "--older-than", "7", "--confirm"])

    expect(existsSync(join(dir, ".."))).toBe(false)
  })

  // The file is written before the first request, so an unreadable one is the run somebody wants
  // to look at — never the one to delete.
  it("leaves a directory whose run.json cannot be read", async () => {
    makeRun("old-run", 30)
    const broken = join(runsDir, day(40).toISOString().slice(0, 10), "broken-run")
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, "run.json"), "{ not json")

    await run(["cleanup", "--older-than", "7", "--confirm"])

    expect(existsSync(broken)).toBe(true)
  })

  it.each([["0"], ["-3"], ["nonsense"]])("refuses --older-than %s", async (value) => {
    await expect(run(["cleanup", "--older-than", value, "--confirm"])).rejects.toThrow(/whole number of days/)
  })
})
