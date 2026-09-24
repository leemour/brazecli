import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { beforeEach, describe, expect, it } from "vitest"
import { emptyConfig, saveConfig } from "../config/file.js"
import { run } from "../program.js"
import type { RunMetadata } from "../runs/run.js"

let configDir: string
let runsDir: string
let inputDir: string
let streams: ReturnType<typeof captureStreams>

const braze = (argv: string[], mock: ReturnType<typeof mockBraze>, readOnly = false) => {
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.iad-01.braze.com", readOnly }
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
    isTty: false,
    fetch: mock.fetch,
  })
}

const users = (count: number, extra: (row: number) => Record<string, unknown> = () => ({})): string => {
  const path = join(inputDir, `users-${count}-${Math.random().toString(36).slice(2)}.jsonl`)
  const lines = [...Array(count)].map((_, index) =>
    JSON.stringify({ external_id: `u${index + 1}`, ...extra(index + 1) }),
  )
  writeFileSync(path, `${lines.join("\n")}\n`)
  return path
}

/** The one run this CLI made, found the way `braze runs list` finds it. */
const lastRun = (): { metadata: RunMetadata; records: string } => {
  const day = readdirSync(runsDir).sort().at(-1) as string
  const id = readdirSync(join(runsDir, day)).sort().at(-1) as string
  const dir = join(runsDir, day, id)

  return {
    metadata: JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunMetadata,
    records: readFileSync(join(dir, "records.csv"), "utf8"),
  }
}

const rows = (csv: string): Record<string, string>[] => {
  const [header, ...lines] = csv.trim().split("\n")
  const columns = (header as string).split(",")

  return lines.map((line) => {
    const cells = line.split(",")
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]))
  })
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-rec-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-recruns-"))
  inputDir = mkdtempSync(join(tmpdir(), "brazecli-recin-"))
  streams = captureStreams()
})

describe("a bulk run end to end", () => {
  it("sends 150 records as two requests and leaves 150 audit rows", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      ["users", "track", "--records", users(150), "--records-field", "attributes", "--confirm", "--json"],
      mock,
    )

    expect(code).toBe(0)
    expect(mock.requests).toHaveLength(2)

    const { records } = lastRun()
    expect(rows(records)).toHaveLength(150)
  })

  /** §33: one row per logical record, not per HTTP request. A request with 75 users is 75 rows. */
  it("gives every record its own row, with the batch that carried it", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    await braze(
      ["users", "track", "--records", users(80), "--records-field", "attributes", "--confirm", "--json"],
      mock,
    )

    const audit = rows(lastRun().records)
    expect(audit).toHaveLength(80)
    expect(audit[0]?.batch_id).toBe("1")
    expect(audit[79]?.batch_id).toBe("2")
    expect(audit.every((row) => row.status === "submitted")).toBe(true)
  })

  /** `NEED-31`: there is no such thing as an audit row nobody can act on. */
  it("names every row, and says the id was ours", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    await braze(["users", "track", "--records", users(3), "--records-field", "attributes", "--confirm", "--json"], mock)

    const audit = rows(lastRun().records)
    expect(audit.every((row) => row.record_id !== "")).toBe(true)
    expect(audit.every((row) => row.record_id_source === "generated")).toBe(true)
    expect(audit[0]?.record_id).toContain(lastRun().metadata.runId)
  })

  it("takes the caller's own id when they name the key", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const path = users(2, (row) => ({ crm_id: `crm-${row}` }))

    await braze(
      [
        "users",
        "track",
        "--records",
        path,
        "--records-field",
        "attributes",
        "--record-id",
        "crm_id",
        "--confirm",
        "--json",
      ],
      mock,
    )

    const audit = rows(lastRun().records)
    expect(audit.map((row) => row.record_id)).toEqual(["crm-1", "crm-2"])
    expect(audit.every((row) => row.record_id_source === "input")).toBe(true)
  })

  /** §35: the audit is deliberately poorer than the file it describes. */
  it("keeps the identifiers and none of the attributes", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const path = users(1, () => ({ salary: 90_000, diagnosis: "private" }))

    await braze(["users", "track", "--records", path, "--records-field", "attributes", "--confirm", "--json"], mock)

    const { records } = lastRun()
    expect(records).toContain("u1")
    expect(records).not.toContain("90000")
    expect(records).not.toContain("private")
    // What went to Braze is untouched: reducing the record would send an empty user object.
    expect(mock.requests[0]?.body).toContain("diagnosis")
  })
})

describe("the summary is the result", () => {
  it("goes to stdout, where a script reads it", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    await braze(["users", "track", "--records", users(3), "--records-field", "attributes", "--confirm", "--json"], mock)

    const summary = JSON.parse(streams.stdout.join("\n"))
    expect(summary.records).toBe(3)
    expect(summary.submitted).toBe(3)
    expect(summary.batches).toBe(1)
  })

  it("counts every record exactly once across the six statuses", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const path = users(4, (row) => (row === 2 ? { external_id: "", colour: "amber" } : {}))

    await braze(["users", "track", "--records", path, "--records-field", "attributes", "--confirm", "--json"], mock)

    const summary = JSON.parse(streams.stdout.join("\n"))
    const total =
      summary.planned + summary.submitted + summary.failed + summary.unknown + summary.invalid + summary.skipped

    expect(total).toBe(summary.records)
    expect(summary.invalid).toBe(1)
    expect(summary.submitted).toBe(3)
  })

  /** One tally feeds both, so they cannot drift apart and leave nobody able to trust either. */
  it("never disagrees with run.json", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    await braze(["users", "track", "--records", users(5), "--records-field", "attributes", "--confirm", "--json"], mock)

    const summary = JSON.parse(streams.stdout.join("\n"))
    const { metadata } = lastRun()

    expect(metadata.inputRecords).toBe(summary.records)
    expect(metadata.submittedRecords).toBe(summary.submitted)
    expect(metadata.invalidRecords).toBe(summary.invalid)
    expect(metadata.skippedRecords).toBe(summary.skipped)
    expect(metadata.httpRequests).toBe(summary.requests)
  })

  /** `NEED-32`: a run that sent 750 000 records and had some refused did what it was asked. */
  it("exits 0 however many records Braze refused", async () => {
    const mock = mockBraze(() => brazeResponses.error(400, "Bad Request"))

    const code = await braze(
      ["users", "track", "--records", users(3), "--records-field", "attributes", "--confirm", "--json"],
      mock,
    )

    expect(code).toBe(0)
    expect(JSON.parse(streams.stdout.join("\n")).failed).toBe(3)
  })

  it("still exits non-zero when the run could not start at all", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      [
        "users",
        "track",
        "--records",
        join(inputDir, "absent.jsonl"),
        "--records-field",
        "attributes",
        "--confirm",
        "--json",
      ],
      mock,
    )

    expect(code).not.toBe(0)
    expect(mock.requests).toHaveLength(0)
  })
})

describe("a dry run", () => {
  /** The main reason to run this at all the first time: check a two-million-row file for free. */
  it("plans every record, sends nothing, and still writes the audit", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      ["users", "track", "--records", users(80), "--records-field", "attributes", "--dry-run", "--json"],
      mock,
    )

    expect(code).toBe(0)
    expect(mock.requests).toHaveLength(0)

    const { metadata, records } = lastRun()
    const audit = rows(records)
    expect(audit).toHaveLength(80)
    expect(audit.every((row) => row.status === "planned")).toBe(true)
    // The batch a record would have been in — which is the arithmetic a dry run exists to show.
    expect(audit[79]?.batch_id).toBe("2")
    expect(metadata.status).toBe("dry-run")
  })

  it("needs no --confirm, because nothing is sent", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      ["users", "track", "--records", users(2), "--records-field", "attributes", "--dry-run", "--json"],
      mock,
    )

    expect(code).toBe(0)
  })
})

describe("what the flags refuse", () => {
  it("refuses --input and --records together, because they are different operations", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      [
        "users",
        "track",
        "--records",
        users(1),
        "--records-field",
        "attributes",
        "--input",
        '{"attributes":[]}',
        "--confirm",
        "--json",
      ],
      mock,
    )

    expect(code).not.toBe(0)
    expect(streams.stderr.join("\n")).toContain("--records")
  })

  it("refuses to guess which array a file holds", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(["users", "track", "--records", users(1), "--confirm", "--json"], mock)

    expect(code).not.toBe(0)
    expect(streams.stderr.join("\n")).toContain("--records-field")
  })

  it("needs the format named when the records come from standard input", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      ["users", "track", "--records", "-", "--records-field", "attributes", "--confirm", "--json"],
      mock,
    )

    expect(code).not.toBe(0)
    expect(streams.stderr.join("\n")).toContain("--records-format")
  })

  it("refuses a bulk write on a read-only profile, like any other write", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(
      ["users", "track", "--records", users(1), "--records-field", "attributes", "--confirm", "--json"],
      mock,
      true,
    )

    expect(code).not.toBe(0)
    expect(mock.requests).toHaveLength(0)
  })

  it("refuses a bulk write with no --confirm, like any other write", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    const code = await braze(["users", "track", "--records", users(1), "--records-field", "attributes", "--json"], mock)

    expect(code).not.toBe(0)
    expect(mock.requests).toHaveLength(0)
  })
})

describe("progress", () => {
  /** Rule 3: in a machine mode stdout carries the summary and nothing else, ever. */
  it("never reaches stdout", async () => {
    const mock = mockBraze(() => brazeResponses.created())

    await braze(
      ["users", "track", "--records", users(200), "--records-field", "attributes", "--confirm", "--json"],
      mock,
    )

    // One JSON value, parseable on its own — no counter lines woven through it.
    expect(() => JSON.parse(streams.stdout.join("\n"))).not.toThrow()
  })
})
