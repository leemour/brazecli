import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BulkOutcome } from "brazecli-core"
import { describe, expect, it } from "vitest"
import { openRecordsFile } from "./records-file.js"

// The control character is the point: the audit must not carry one into a terminal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the test
const RAW_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/

const outcome = (over: Partial<BulkOutcome> = {}): BulkOutcome => ({
  row: 1,
  recordId: "r1",
  recordIdSource: "input",
  batchId: 1,
  status: "failed",
  ...over,
})

const write = async (...outcomes: BulkOutcome[]): Promise<string> => {
  const file = openRecordsFile(mkdtempSync(join(tmpdir(), "brazecli-audit-")), "users.track")
  for (const one of outcomes) await file.write(one)
  await file.close()
  return readFileSync(file.path, "utf8")
}

// SEC-2. `error_message` is Braze's own words; `record_id` and `external_id` come from whoever's
// file was loaded. Excel and LibreOffice execute a cell starting `=`, `+`, `-` or `@` even when
// the CSV quotes it, so quoting is not the defence.
describe("a cell a spreadsheet would execute", () => {
  it("marks free text from Braze as literal", async () => {
    const csv = await write(outcome({ errorMessage: '=HYPERLINK("http://evil","click")' }))

    expect(csv).toContain(`'=HYPERLINK`)
  })

  it("marks a hostile note as literal too", async () => {
    expect(await write(outcome({ note: "+1+1" }))).toContain("'+1+1")
  })

  it("leaves an identifier byte-exact, because a prefixed one no longer joins to the input", async () => {
    const csv = await write(outcome({ recordId: "=weird-but-theirs", identity: { external_id: "-also-theirs" } }))

    expect(csv).toContain("=weird-but-theirs")
    expect(csv).not.toContain("'=weird-but-theirs")
    expect(csv).toContain("-also-theirs")
    expect(csv).not.toContain("'-also-theirs")
  })

  it("leaves an ordinary message alone", async () => {
    const csv = await write(outcome({ errorMessage: "Invalid API key" }))

    expect(csv).toContain("Invalid API key")
    expect(csv).not.toContain("'Invalid")
  })
})

describe("control characters in the audit", () => {
  it("makes them visible in every column, free text and identifier alike", async () => {
    const csv = await write(
      outcome({
        recordId: "r\u001b[2K1",
        errorMessage: "refused\u001b[1Gnot really",
        note: "bell\u0007",
      }),
    )

    expect(csv).not.toMatch(RAW_CONTROL)
    expect(csv).toContain("\\x1b[2K")
    expect(csv).toContain("\\x07")
  })

  it("keeps the row count and the numeric columns untouched", async () => {
    const csv = await write(outcome({ row: 7, httpStatus: 400, attempts: 2 }))
    const [header, first] = csv.trimEnd().split("\n")

    expect(header?.split(",")).toContain("http_status")
    expect(first).toContain("400")
    expect(csv.trimEnd().split("\n")).toHaveLength(2)
  })
})
