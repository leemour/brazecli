import type { Renderer, Streams } from "@leemour/cli-core"
import { type BrazeClient, executeBulk, type Operation } from "brazecli-core"
import { type RecordsFormat, type RecordsOptions, readRecords } from "./input/records.js"
import { createProgress } from "./output/progress.js"
import { openRecordsFile } from "./runs/records-file.js"
import type { Run } from "./runs/run.js"
import { type BulkSummary, count, newTally, renderSummary, summarize } from "./runs/tally.js"

export interface BulkRun {
  operation: Operation
  client: BrazeClient
  run: Run
  renderer: Renderer
  streams: Streams
  source: string
  format: RecordsFormat
  records: RecordsOptions
  concurrency: number
  dryRun: boolean
  interactive: boolean
  outputFormat: string
  now?: () => number
}

/**
 * A bulk run, from a file to an audit and a summary.
 *
 * **The summary is the result, not a diagnostic.** A single request prints Braze's answer; a run of
 * 750 000 records has no single answer, so what the caller actually asked — what became of them —
 * goes to stdout in both modes. `NEED-32` makes it the thing a script branches on, because an exit
 * code cannot carry "612 of 750 000, and here is which".
 */
export const runBulk = async (options: BulkRun): Promise<BulkSummary> => {
  const { operation, run, renderer, streams } = options
  const now = options.now ?? (() => Date.now())
  const startedAt = now()

  const records = readRecords(options.source, options.format, operation, options.records)
  const audit = openRecordsFile(run.dir, operation.id)
  const tally = newTally()
  const progress = createProgress({
    streams,
    enabled: options.interactive && options.outputFormat === "pretty",
  })

  const outcomes = executeBulk(options.client, operation, records, {
    runId: run.id,
    concurrency: options.concurrency,
    signal: run.signal,
    dryRun: options.dryRun,
  })

  const body = async (): Promise<BulkSummary> => {
    try {
      for await (const outcome of outcomes) {
        // Written before it is counted. A run killed between the two is one row short in the
        // summary; the other way round it is one row short in the audit, and the audit is the
        // thing somebody re-reads a week later.
        await audit.write(outcome)
        count(tally, outcome)
        progress.advance(tally.records, tally.batches)
      }
    } finally {
      progress.clear()
      await audit.close()
    }

    const summary = summarize(tally, {
      concurrency: options.concurrency,
      durationMs: now() - startedAt,
      recordsFile: audit.path,
      dryRun: options.dryRun,
      interrupted: run.signal.aborted,
    })

    renderer.result(options.outputFormat === "pretty" ? renderSummary(summary) : summary)

    if (summary.interrupted) {
      renderer.warn(`interrupted — ${summary.skipped.toLocaleString("en-US")} records were never sent`)
    }
    renderer.note(`records.csv · ${audit.path}`)

    await run.finish(summary.interrupted ? "cancelled" : options.dryRun ? "dry-run" : "success", {
      inputRecords: summary.records,
      plannedRecords: summary.planned,
      submittedRecords: summary.submitted,
      failedRecords: summary.failed,
      unknownRecords: summary.unknown,
      invalidRecords: summary.invalid,
      skippedRecords: summary.skipped,
      httpRequests: summary.requests,
      httpRetries: summary.retries,
    })

    return summary
  }

  // The signal handler waits for this before writing the run file and exiting. Without it, Ctrl+C
  // kills the process while the executor is still emitting `skipped` rows: the CSV ends mid-row and
  // the summary — the one thing that says how far the run got — never prints (`BULK-8`).
  const finished = body()
  run.onDrain(async () => {
    await finished
  })

  return finished
}
