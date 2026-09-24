import type { Streams } from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { resolvePaths } from "../config/paths.js"
import { outputFor } from "../output/context.js"
import { expiredRuns, findRun, listRuns, removeRun } from "../runs/run.js"

export interface RunsContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

/**
 * Reads run artifacts. Deliberately needs no profile and no key: the whole point is to be able
 * to look at what happened after something went wrong with the configuration.
 */
export const runsCommand = (context: RunsContext = {}): Command => {
  const command = new Command("runs").description("inspect what past invocations did")

  const setup = (parent: Command) => {
    // A broken config must not stop someone reading the logs that would explain it.
    const { env, globals, streams, renderer } = outputFor(parent, context)
    const paths = resolvePaths(env)
    if (globals.runsDir) paths.runs = globals.runsDir
    return { paths, streams, renderer }
  }

  command
    .command("list")
    .option("--limit <n>", "how many to show, newest first", Number, 20)
    .description("list past runs, newest first")
    .action(function (this: Command, flags: { limit: number }) {
      const { paths, renderer } = setup(this)
      const runs = listRuns(paths.runs).slice(0, flags.limit)

      renderer.result(
        runs.map((run) => ({
          runId: run.runId,
          command: run.command,
          profile: run.profile,
          status: run.status,
          startedAt: run.startedAt,
          durationMs: run.durationMs ?? null,
        })),
      )
    })

  command
    .command("show")
    .argument("<run-id>", "id from `braze runs list`")
    .description("everything recorded about one run")
    .action(function (this: Command, id: string) {
      const { paths, renderer } = setup(this)
      const found = findRun(paths.runs, id)
      if (!found) throw new BrazeError("not_found", `no run named "${id}" under ${paths.runs}`)

      renderer.result({ ...found.metadata, directory: found.dir })
    })

  command
    .command("path")
    .argument("<run-id>", "id from `braze runs list`")
    .description("the directory holding a run's artifacts")
    .action(function (this: Command, id: string) {
      const { paths, streams } = setup(this)
      const found = findRun(paths.runs, id)
      if (!found) throw new BrazeError("not_found", `no run named "${id}" under ${paths.runs}`)

      // A bare path, so it composes: `cat "$(braze runs path <id>)/events.jsonl"`.
      streams.data(found.dir)
    })

  /**
   * Nothing expires on a timer (`NEED-3`): a run's `records.csv` is the only evidence an operation
   * happened, so removal is asked for explicitly, every time, with the age named and `--confirm`
   * given. There is no retention setting in the config file, deliberately — a value set once and
   * forgotten is how a timer gets reinvented.
   */
  command
    .command("cleanup")
    .requiredOption("--older-than <days>", "remove runs that started more than this many days ago", Number)
    .option("--dry-run", "list what would be removed and remove nothing", false)
    .option("--confirm", "actually remove them", false)
    .description("remove old run directories — opt-in, never automatic")
    .action(function (this: Command, flags: { olderThan: number; dryRun: boolean; confirm: boolean }) {
      const { paths, renderer } = setup(this)

      if (!Number.isFinite(flags.olderThan) || flags.olderThan < 1) {
        throw new BrazeError("validation_error", "--older-than takes a whole number of days, 1 or more")
      }

      const before = new Date(Date.now() - flags.olderThan * 86_400_000)
      const expired = expiredRuns(paths.runs, before)
      const bytes = expired.reduce((total, run) => total + run.bytes, 0)
      const runs = expired.map((run) => ({
        runId: run.metadata.runId,
        command: run.metadata.command,
        startedAt: run.metadata.startedAt,
        bytes: run.bytes,
      }))

      if (flags.dryRun) {
        renderer.result({ dryRun: true, olderThanDays: flags.olderThan, runs, count: runs.length, bytes })
        return
      }

      if (!flags.confirm) {
        throw new BrazeError(
          "confirmation_required",
          expired.length === 0
            ? `no run started more than ${flags.olderThan} days ago — nothing to remove`
            : `${expired.length} runs would be removed, freeing ${bytes} bytes. Pass --confirm to do it, ` +
                "or --dry-run to see which.",
        )
      }

      for (const run of expired) removeRun(paths.runs, run.dir)

      renderer.result({ removed: runs.length, bytes, runs })
    })

  return command
}
