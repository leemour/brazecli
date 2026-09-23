import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { writeSecurely } from "../config/file.js"
import { createRunLogger, type RunLogger } from "../logging/logger.js"

export type RunStatus = "success" | "failed" | "cancelled" | "dry-run"

export interface RunMetadata {
  runId: string
  command: string
  operation?: string
  profile: string
  startedAt: string
  completedAt?: string
  status: RunStatus | "running"
  inputRecords?: number
  /**
   * One per §34 status, so the summary on stdout and this file are generated from the same tally
   * and cannot disagree. Phase 1 reserved four of the six; `planned`, `invalid` and `skipped` are
   * the ones a bulk run turned out to need.
   */
  plannedRecords?: number
  submittedRecords?: number
  failedRecords?: number
  unknownRecords?: number
  invalidRecords?: number
  skippedRecords?: number
  httpRequests?: number
  httpRetries?: number
  durationMs?: number
  cliVersion: string
  catalogVersion?: string
  /** Never the message of a `BrazeError` alone — the code is what a script reads. */
  errorCode?: string
}

export interface StartRunOptions {
  runsDir: string
  command: string
  operation?: string
  profile: string
  cliVersion: string
  logLevel?: string
  runId?: string
  now?: () => Date
}

export interface Run {
  id: string
  dir: string
  logger: RunLogger
  /**
   * Aborted when the run is cancelled. Passed to `client.execute`, which already turns an abort
   * into `cancelled` — or into `outcome_unknown` for a write that may have reached Braze, which is
   * the distinction rule 4 exists for.
   */
  signal: AbortSignal
  /** Stops work in flight. Safe to call more than once. */
  cancel(): void
  /**
   * Registers the work a signal must wait for before the run file is written — see `Interruptible`
   * in `signals.ts`. A command with nothing to wind down never calls it.
   */
  onDrain(drain: () => Promise<void>): void
  drain?: () => Promise<void>
  /**
   * Writes the final `run.json` and closes the log. **Must run on every path** — success, a
   * refusal, a signal. A directory holding `events.jsonl` and no `run.json` is a special case
   * `runs list` would have to carry forever.
   */
  finish(status: RunStatus, extra?: Partial<RunMetadata>): Promise<void>
}

export const startRun = (options: StartRunOptions): Run => {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const id = options.runId ?? runId(startedAt, options.command)
  const dir = join(options.runsDir, startedAt.toISOString().slice(0, 10), id)

  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const logger = createRunLogger({
    path: join(dir, "events.jsonl"),
    level: options.logLevel,
    base: { run_id: id, command: options.command, profile: options.profile },
  })

  const metadata: RunMetadata = {
    runId: id,
    command: options.command,
    operation: options.operation,
    profile: options.profile,
    startedAt: startedAt.toISOString(),
    status: "running",
    cliVersion: options.cliVersion,
  }
  writeRunFile(dir, metadata)

  let finished = false
  const controller = new AbortController()

  const run: Run = {
    id,
    dir,
    logger,
    signal: controller.signal,
    cancel: () => {
      if (!controller.signal.aborted) controller.abort()
    },
    onDrain: (drain) => {
      run.drain = drain
    },
    finish: async (status, extra = {}) => {
      if (finished) return
      finished = true

      const completedAt = now()
      writeRunFile(dir, {
        ...metadata,
        ...extra,
        status,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      })
      await logger.close()
    },
  }

  return run
}

/** `20260913T191500Z-users-track-a81f2c` — sortable, and readable without opening it. */
const runId = (startedAt: Date, command: string): string => {
  const stamp = startedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const slug = command.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  const suffix = crypto.randomUUID().slice(0, 6)
  return `${stamp}-${slug}-${suffix}`
}

const writeRunFile = (dir: string, metadata: RunMetadata): void => {
  // Atomic, so a reader never sees half a file — and 0600, because the metadata names a profile
  // and an operation even though it carries no key.
  writeSecurely(join(dir, "run.json"), `${JSON.stringify(metadata, null, 2)}\n`, 0o600)
}

export const listRuns = (runsDir: string): RunMetadata[] => {
  const runs: RunMetadata[] = []

  for (const day of safeReaddir(runsDir).sort().reverse()) {
    for (const entry of safeReaddir(join(runsDir, day)).sort().reverse()) {
      const metadata = readRun(join(runsDir, day, entry))
      if (metadata) runs.push(metadata)
    }
  }
  return runs
}

export const findRun = (runsDir: string, id: string): { dir: string; metadata: RunMetadata } | undefined => {
  for (const day of safeReaddir(runsDir)) {
    const dir = join(runsDir, day, id)
    const metadata = readRun(dir)
    if (metadata) return { dir, metadata }
  }
  return undefined
}

export interface ExpiredRun {
  dir: string
  metadata: RunMetadata
  bytes: number
}

/**
 * Runs that finished before `before`, oldest first.
 *
 * **A directory whose `run.json` cannot be read is never returned**, so it is never deleted. That
 * file is written before the first request and finalized on every path, so an unreadable one means
 * something went wrong — which is exactly the run somebody will want to look at. Deleting what we
 * cannot identify is the opposite of what an audit is for.
 */
export const expiredRuns = (runsDir: string, before: Date): ExpiredRun[] =>
  listRuns(runsDir)
    .filter((metadata) => new Date(metadata.startedAt) < before)
    .reverse()
    .flatMap((metadata) => {
      const found = findRun(runsDir, metadata.runId)
      return found ? [{ dir: found.dir, metadata, bytes: directoryBytes(found.dir) }] : []
    })

/** Removes one run directory, and the day directory when that was its last run. */
export const removeRun = (runsDir: string, dir: string): void => {
  rmSync(dir, { recursive: true, force: true })

  const day = join(dir, "..")
  if (day !== runsDir && safeReaddir(day).length === 0) rmSync(day, { recursive: true, force: true })
}

const directoryBytes = (dir: string): number =>
  safeReaddir(dir).reduce((total, entry) => {
    try {
      return total + statSync(join(dir, entry)).size
    } catch {
      return total
    }
  }, 0)

const readRun = (dir: string): RunMetadata | undefined => {
  try {
    return JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunMetadata
  } catch {
    return undefined
  }
}

const safeReaddir = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
