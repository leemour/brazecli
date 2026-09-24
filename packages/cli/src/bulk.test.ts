import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, createRenderer } from "@leemour/cli-core"
import { BrazeClient, findOperation } from "brazecli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runBulk } from "./bulk.js"
import { type Run, startRun } from "./runs/run.js"

const track = findOperation("users.track.create") as NonNullable<ReturnType<typeof findOperation>>

let runsDir: string
let inputDir: string
let streams: ReturnType<typeof captureStreams>

const users = (count: number): string => {
  const path = join(inputDir, `users-${count}.jsonl`)
  const lines = [...Array(count)].map((_, index) => JSON.stringify({ external_id: `u${index + 1}` }))
  writeFileSync(path, `${lines.join("\n")}\n`)
  return path
}

const bulk = (run: Run, source: string, mock: ReturnType<typeof mockBraze>, concurrency = 1) =>
  runBulk({
    operation: track,
    client: new BrazeClient({ endpoint: "https://rest.iad-01.braze.com", apiKey: "k", fetch: mock.fetch }),
    run,
    renderer: createRenderer({ format: "json", color: false, streams }),
    streams,
    source,
    format: "jsonl",
    records: { field: "attributes" },
    concurrency,
    dryRun: false,
    interactive: false,
    outputFormat: "json",
  })

const newRun = (): Run =>
  startRun({ runsDir, command: "users track", operation: track.id, profile: "test", cliVersion: "0.0.0" })

const auditRows = (run: Run): string[] => readFileSync(join(run.dir, "records.csv"), "utf8").trim().split("\n").slice(1)

/** Lines currently in the audit, header included. 0 before it exists. */
const lines = (run: Run): number => {
  try {
    return readFileSync(join(run.dir, "records.csv"), "utf8").trim().split("\n").length
  } catch {
    return 0
  }
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-bulkruns-"))
  inputDir = mkdtempSync(join(tmpdir(), "brazecli-bulkin-"))
  streams = captureStreams()
})

// The other test files leave their temp directories behind, and at a few kilobytes each that is
// fine. This one writes a million-row input and a million-row audit — a quarter of a gigabyte per
// run — so it puts them back.
afterEach(() => {
  for (const dir of [runsDir, inputDir]) rmSync(dir, { recursive: true, force: true })
})

describe("a run interrupted in the middle", () => {
  /**
   * The interrupted run is when the audit matters most: somebody has to know which records went and
   * which did not. 500 in, 500 out — nothing silently disappears.
   */
  it("accounts for every record, and calls the ones that never went skipped", async () => {
    const run = newRun()
    const mock = mockBraze(() => {
      run.cancel()
      return brazeResponses.created()
    })

    const summary = await bulk(run, users(500), mock)

    const accounted =
      summary.planned + summary.submitted + summary.failed + summary.unknown + summary.invalid + summary.skipped

    expect(summary.records).toBe(500)
    expect(summary.skipped).toBeGreaterThan(0)
    expect(accounted).toBe(500)
    expect(summary.interrupted).toBe(true)
    // Nothing is `failed`: Braze refused none of them. The batch already in flight finished and is
    // `submitted`; everything the signal caught before it was sent is `skipped`. A write cancelled
    // mid-flight would be `unknown` — never `failed`, since stopping waiting is not the same as it
    // not happening (rule 4).
    expect(summary.failed).toBe(0)
  })

  it("still prints the summary — that is when the counts matter most", async () => {
    const run = newRun()
    const mock = mockBraze(() => {
      run.cancel()
      return brazeResponses.created()
    })

    await bulk(run, users(200), mock)

    const summary = JSON.parse(streams.stdout.join("\n"))
    expect(summary.interrupted).toBe(true)
    expect(summary.skipped).toBeGreaterThan(0)
    expect(streams.stderr.join("\n")).toContain("never sent")
  })

  /** A half-written row reads as a successful submission, which is the worst thing this file can do. */
  it("leaves an audit whose every row is complete", async () => {
    const run = newRun()
    const mock = mockBraze(() => {
      run.cancel()
      return brazeResponses.created()
    })

    await bulk(run, users(300), mock)

    const rows = auditRows(run)
    expect(rows).toHaveLength(300)
    // Every row has the same number of columns as the header, so none was cut short.
    const columns = readFileSync(join(run.dir, "records.csv"), "utf8").split("\n")[0]?.split(",").length
    expect(rows.every((row) => row.split(",").length === columns)).toBe(true)
  })

  it("records the run as cancelled, with the counts that explain it", async () => {
    const run = newRun()
    const mock = mockBraze(() => {
      run.cancel()
      return brazeResponses.created()
    })

    const summary = await bulk(run, users(200), mock)
    const metadata = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8"))

    expect(metadata.status).toBe("cancelled")
    expect(metadata.skippedRecords).toBe(summary.skipped)
    expect(metadata.inputRecords).toBe(200)
  })
})

describe("the audit is written as work completes", () => {
  /**
   * `BULK-5` means the rows are handed over per record rather than collected and written at the
   * end — but a row handed to a stream is not yet a row on disk, so "read the file mid-run" tests
   * the operating system's buffer, not this code. What the audit actually promises is that **any
   * orderly end leaves every row on disk**, a signal included, and that is what is checked here and
   * in the interrupted run above. A `kill -9` is outside what any buffered writer can promise.
   */
  it("has every row on disk the moment the run returns", async () => {
    const run = newRun()
    const mock = mockBraze(() => brazeResponses.created())

    const summary = await bulk(run, users(300), mock)

    expect(lines(run)).toBe(301)
    expect(auditRows(run)).toHaveLength(summary.records)
  })

  it("names the audit in the summary, so nobody has to guess where it went", async () => {
    const run = newRun()
    const mock = mockBraze(() => brazeResponses.created())

    const summary = await bulk(run, users(2), mock)

    expect(summary.recordsFile).toBe(join(run.dir, "records.csv"))
  })
})

describe("the whole pipeline streams, not just each half", () => {
  /**
   * The audit is the slow end of the pull chain, and the piece that makes it real is `write`
   * waiting when the file cannot keep up. A `write` that ignored that would let the stream's own
   * buffer grow to the size of the run while every other bound still looked satisfied — so this
   * watches the heap through a run big enough for that to show.
   */
  it("keeps the heap bounded while writing a large audit", async () => {
    const run = newRun()
    const mock = mockBraze(() => brazeResponses.created())
    const before = process.memoryUsage().heapUsed

    const summary = await bulk(run, users(200_000), mock, 4)

    const grew = (process.memoryUsage().heapUsed - before) / 1024 / 1024
    expect(summary.records).toBe(200_000)
    expect(auditRows(run)).toHaveLength(200_000)
    expect(grew).toBeLessThan(250)
  }, 180_000)
})

describe("a million records, watched from the heap", () => {
  /**
   * `BULK-9`'s other half. The exact bound — at most `concurrency * 2 * batchSize` records resident,
   * measured at 599 against a predicted 600 — is asserted in `packages/core/src/bulk/memory.test.ts`,
   * which cannot look at the heap because core may not touch `process`. This is the same claim from
   * the outside, and with the audit writer in the chain, which is where an ignored backpressure
   * signal would actually show.
   */
  it("holds a bounded heap while a million records go by", async () => {
    const run = newRun()
    const mock = mockBraze(() => brazeResponses.created())
    const before = process.memoryUsage().heapUsed

    const summary = await bulk(run, users(1_000_000), mock, 4)

    expect(summary.records).toBe(1_000_000)
    expect((process.memoryUsage().heapUsed - before) / 1024 / 1024).toBeLessThan(250)
  }, 600_000)
})

describe("the request count", () => {
  /**
   * Batches complete out of order once more than one is in flight, so the number of requests cannot
   * be derived from the highest batch id seen so far. With four in flight, batch 3 can arrive before
   * batch 2 — and a high-water mark then never counts batch 2's request at all.
   */
  it("matches the number of requests actually made, with batches completing out of order", async () => {
    const run = newRun()
    const mock = mockBraze(() => brazeResponses.created())

    // Later requests answer sooner, so batch 4 finishes before batch 1. An instant mock always
    // completes in order, which is why this needs arranging rather than assuming.
    let sent = 0
    const backwards = new BrazeClient({
      endpoint: "https://rest.iad-01.braze.com",
      apiKey: "k",
      fetch: async (input, init) => {
        const delay = Math.max(0, 40 - sent * 10)
        sent += 1
        await new Promise((resolve) => setTimeout(resolve, delay))
        return mock.fetch(input, init)
      },
    })

    const summary = await runBulk({
      operation: track,
      client: backwards,
      run,
      renderer: createRenderer({ format: "json", color: false, streams }),
      streams,
      source: users(300),
      format: "jsonl",
      records: { field: "attributes" },
      concurrency: 4,
      dryRun: false,
      interactive: false,
      outputFormat: "json",
    })

    expect(mock.requests).toHaveLength(4)
    expect(summary.requests).toBe(mock.requests.length)
    expect(summary.batches).toBe(4)
  })
})

describe("what counts as a request", () => {
  it("counts a batch Braze refused — the request was made", async () => {
    const run = newRun()
    const mock = mockBraze(() => brazeResponses.error(400, "Bad Request"))

    const summary = await bulk(run, users(150), mock)

    expect(mock.requests).toHaveLength(2)
    expect(summary.requests).toBe(2)
    expect(summary.failed).toBe(150)
  })

  /**
   * The batch already queued when the signal lands never reaches the network. Counting it reports
   * more requests than were made — measured at four for a run that made two, against a black-holed
   * endpoint, before `attempts` became the test.
   */
  it("does not count a batch that was cancelled before it was sent", async () => {
    const run = newRun()
    const mock = mockBraze(() => {
      run.cancel()
      return brazeResponses.created()
    })

    const summary = await bulk(run, users(400), mock, 2)

    expect(summary.requests).toBe(mock.requests.length)
    expect(summary.batches).toBe(mock.requests.length)
  })
})
