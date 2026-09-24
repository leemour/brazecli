import { once } from "node:events"
import { createWriteStream } from "node:fs"
import { join } from "node:path"
import { visibleControls } from "@leemour/cli-core"
import type { BulkOutcome } from "brazecli-core"
import { type Stringifier, stringify } from "csv-stringify"
import { formulaSafe } from "../output/sanitize.js"

/**
 * §33's columns, plus the three the ruling and the status work added: `record_id` and
 * `record_id_source` (`NEED-31` — there is no such thing as a row without an identifier) and
 * `note`, which carries something true about the batch that is not this record's failure.
 *
 * **Identifiers and nothing else** (§35). No custom attribute, no arbitrary column from the input.
 * The audit is deliberately poorer than the file it describes, and this list is where that is
 * enforced — a column added here is customer data persisted forever.
 */
const COLUMNS = [
  "row_number",
  "record_id",
  "record_id_source",
  "batch_id",
  "operation",
  "external_id",
  "braze_id",
  "user_alias_name",
  "user_alias_label",
  "started_at",
  "completed_at",
  "status",
  "http_status",
  "attempts",
  "duration_ms",
  "error_code",
  "error_message",
  "note",
] as const

export interface RecordsFile {
  path: string
  rows: number
  /**
   * **Waits when the file cannot keep up.** This is the slow end of the pull chain: the executor
   * only advances the parser when the consumer asks for the next outcome, so a `write` that
   * ignored backpressure would let the whole pipeline run at Braze's speed and the 600-record
   * ceiling would stop being true on a slow disk.
   */
  write(outcome: BulkOutcome): Promise<void>
  close(): Promise<void>
}

/**
 * The audit, written as work completes rather than at the end — a run killed at record 1 800 000
 * still has 1 800 000 rows (§33, `BULK-5`).
 */
export const openRecordsFile = (dir: string, operation: string): RecordsFile => {
  const path = join(dir, "records.csv")
  const file = createWriteStream(path, { mode: 0o600 })
  const rows: Stringifier = stringify({ header: true, columns: [...COLUMNS] })
  rows.pipe(file)

  let written = 0

  return {
    path,
    get rows() {
      return written
    },
    write: async (outcome) => {
      written += 1
      if (!rows.write(row(outcome, operation))) await once(rows, "drain")
    },
    close: async () => {
      rows.end()
      await once(file, "close")
    },
  }
}

/**
 * Free text from Braze, which a spreadsheet must not execute. Identifiers are deliberately absent:
 * a prefixed `external_id` no longer joins back to the input file, and joining back is the only
 * reason the column exists. The residual risk — a hostile identifier in somebody's own input file,
 * opened in Excel — is named in `docs/security.md` rather than silently traded away.
 */
const FREE_TEXT = ["error_message", "note"] as const

/**
 * Applied to the finished row rather than at each field, so a column added to `COLUMNS` later is
 * covered without anyone remembering to wrap it.
 */
const safe = (values: Record<string, string | number>): Record<string, string | number> =>
  Object.fromEntries(
    Object.entries(values).map(([column, value]) => {
      if (typeof value !== "string") return [column, value]
      const visible = visibleControls(value)
      return [column, (FREE_TEXT as readonly string[]).includes(column) ? formulaSafe(visible) : visible]
    }),
  )

const row = (outcome: BulkOutcome, operation: string): Record<string, string | number> => {
  const identity = outcome.identity ?? {}

  return safe({
    row_number: outcome.row,
    record_id: outcome.recordId,
    record_id_source: outcome.recordIdSource,
    // A record that never reached a request has no batch, and a blank cell says that better than a
    // zero that reads like a real batch number.
    batch_id: outcome.batchId === 0 ? "" : outcome.batchId,
    operation,
    external_id: identity.external_id ?? "",
    braze_id: identity.braze_id ?? "",
    user_alias_name: identity.user_alias?.alias_name ?? "",
    user_alias_label: identity.user_alias?.alias_label ?? "",
    started_at: outcome.startedAt ?? "",
    completed_at: new Date().toISOString(),
    status: outcome.status,
    http_status: outcome.httpStatus ?? "",
    attempts: outcome.attempts ?? "",
    duration_ms: outcome.durationMs ?? "",
    error_code: outcome.errorCode ?? "",
    error_message: outcome.errorMessage ?? "",
    note: outcome.note ?? "",
  })
}
