import { join } from "node:path"
import {
  exitCodeFor,
  GENERIC_FAILURE,
  type KeyringStore,
  processStreams,
  type Streams,
  visibleControls,
} from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import { Command, CommanderError, Option } from "commander"
import { apiCommand } from "./commands/api.js"
import { catalogCommands } from "./commands/catalog.js"
import { commandsCommand } from "./commands/commands.js"
import { completeCommand } from "./commands/complete.js"
import { profileCommand } from "./commands/profile.js"
import { runsCommand } from "./commands/runs.js"
import { schemaCommand } from "./commands/schema.js"
import { skillCommand } from "./commands/skill.js"
import { selfUpdateCommand } from "./commands/update.js"
import { loadConfig, OUTPUT_FORMATS } from "./config/file.js"
import { resolvePaths } from "./config/paths.js"
import { DOCUMENTATION, firstProfileHint } from "./documentation.js"
import { outputFor } from "./output/context.js"
import type { UpdateEnvironment } from "./update.js"
import { VERSION } from "./version.js"

export interface ProgramOptions {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  streams?: Streams
  isTty?: boolean
  fetch?: typeof globalThis.fetch
  /** `profile add --key-stdin`. Injected so a test does not have to own the process's input. */
  readStdin?: () => string
  /** `skill install` writes into these; injected so a test never touches the real home directory. */
  home?: string
  cwd?: string
  /** npm and the package manager, as `braze update` reaches them. */
  update?: UpdateEnvironment
}

export const buildProgram = (options: ProgramOptions = {}): Command => {
  const program = new Command("braze")
    .description("Braze REST API from the command line, for agents and for people")
    .version(VERSION, "-V, --version")
    .option("--profile <name>", "which configured profile to use")
    .option("--json", "one deterministic JSON value on stdout, whatever the terminal is")
    .addOption(new Option("--output <format>", "output mode").choices([...OUTPUT_FORMATS]))
    .option("--no-color", "never emit ANSI colour")
    .option("--quiet", "no notes, successes or warnings on stderr; results and failures are unchanged")
    .option("--dry-run", "resolve, validate and count, but send nothing")
    .option("--confirm", "required before any write; never an interactive prompt")
    .option("--paginate", "walk the pages of a paged read and return them as one value")
    .option("--max-pages <n>", "how many pages --paginate may walk (default 10)", Number)
    .option("--max-items <n>", "stop --paginate once this many rows have been collected", Number)
    .option("--records <source>", "a file of many records to batch and send, or - for standard input")
    .addOption(new Option("--records-format <format>", "how --records is encoded").choices(["jsonl", "csv"]))
    .option("--records-field <name>", "which batch field the records belong in, e.g. attributes")
    .option("--record-id <key>", "key of each record holding your own id for it, for the audit")
    .option("--concurrency <n>", "how many requests a bulk run may have in flight, 1-32", Number)
    .option("--runs-dir <path>", "where run artifacts are written")
    .option("--timeout <ms>", "per-attempt timeout in milliseconds", Number)
    .option("--retries <n>", "attempts after the first", Number)
    .showHelpAfterError()
    .addHelpText("after", () => helpFooter(options))

  program.addCommand(profileCommand(options))
  program.addCommand(apiCommand(options))
  program.addCommand(runsCommand(options))
  program.addCommand(commandsCommand(options))
  program.addCommand(schemaCommand(options))
  program.addCommand(skillCommand(options))
  program.addCommand(selfUpdateCommand(options))
  program.addCommand(completeCommand(options), { hidden: true })

  // §13: registered in a loop, never as a hundred nearly identical files. After the handwritten
  // ones, so a name collision would be visible rather than silently shadowing `profile` or `runs`.
  for (const command of catalogCommands(options)) program.addCommand(command)

  return program
}

/**
 * Turns any failure into the one exit code a script branches on, and keeps the message on
 * stderr — stdout belongs to data even when everything went wrong.
 */
export const run = async (argv: string[], options: ProgramOptions = {}): Promise<number> => {
  const streams = options.streams ?? processStreams
  const program = buildProgram(options)
  const { profile, rest } = takeProfile(argv, options)

  // Commander otherwise calls process.exit itself — for --help, for --version and for every usage
  // error — so none of them reached this function, a JSON caller got a line of prose, and a test
  // could not run them. Every level, because `braze campaigns list --bogus` fails in the leaf.
  // Its error text is held back: in a machine mode the failure is reported as JSON instead.
  const held: string[] = []
  forEachCommand(program, (command) =>
    command.exitOverride().configureOutput({
      writeOut: (text) => streams.data(text.replace(/\n$/, "")),
      writeErr: (text) => held.push(text.replace(/\n$/, "")),
    }),
  )

  try {
    await program.parseAsync(profile ? ["--profile", profile, ...rest] : rest, { from: "user" })
    return 0
  } catch (error) {
    if (error instanceof BrazeError) {
      report(program, options, streams, { code: error.code, message: error.message, ...error.details })
      return exitCodeFor(error.code)
    }
    if (error instanceof CommanderError) {
      if (!USAGE_ERRORS.has(error.code)) {
        for (const text of held) streams.diagnostic(text)
        return error.exitCode
      }
      if (formatOf(program, options) === "pretty") for (const text of held) streams.diagnostic(text)
      else
        report(program, options, streams, { code: "validation_error", message: error.message.replace(/^error: /, "") })
      return exitCodeFor("validation_error")
    }

    const message = error instanceof Error ? error.message : String(error)
    report(program, options, streams, { code: "generic_failure", message })
    return GENERIC_FAILURE
  }
}

interface ReportedError {
  code: string
  message: string
  [detail: string]: unknown
}

/**
 * A machine mode gets the failure as JSON, because an exit code says which kind of thing went
 * wrong and nothing about which record or how long to wait. It goes to **stderr**: stdout is
 * data, and an agent reading it must never mistake a refusal for a result.
 */
const report = (program: Command, options: ProgramOptions, streams: Streams, error: ReportedError): void => {
  streams.diagnostic(
    formatOf(program, options) === "pretty"
      ? `${error.code}: ${visibleControls(error.message)}`
      : JSON.stringify({ error }),
  )
}

// Reporting a failure must not depend on the configuration, which may be the failure.
const formatOf = (program: Command, options: ProgramOptions) => outputFor(program, options).format

/** The Commander failures that mean "the command line is wrong" — `validation_error`, exit 2. */
const USAGE_ERRORS = new Set([
  "commander.unknownOption",
  "commander.unknownCommand",
  "commander.missingArgument",
  "commander.optionMissingArgument",
  "commander.missingMandatoryOptionValue",
  "commander.invalidArgument",
  "commander.excessArguments",
  "commander.conflictingOption",
])

const forEachCommand = (command: Command, apply: (command: Command) => void): void => {
  apply(command)
  for (const child of command.commands) forEachCommand(child, apply)
}

/**
 * Built per invocation, not once: the paths come from the environment, and a first-time user
 * reading this has a different question from someone with three profiles configured.
 */
const helpFooter = (options: ProgramOptions): string => {
  const env = options.env ?? process.env
  const paths = resolvePaths(env)

  let profiles: string[] = []
  try {
    profiles = Object.keys(loadConfig(paths.config).profiles)
  } catch {
    // An unreadable config is exactly when someone reaches for --help.
  }

  const lines =
    profiles.length === 0
      ? ["", firstProfileHint(join(paths.config, "config.json")), ""]
      : [
          "",
          `Profiles: ${profiles.join(", ")} — pick one with \`--profile <name>\` or BRAZE_PROFILE.`,
          "",
          "On this machine:",
          `  config  ${join(paths.config, "config.json")}`,
          `  runs    ${paths.runs}`,
          "",
        ]

  return [
    ...lines,
    "Braze's own documentation:",
    `  endpoints      ${DOCUMENTATION.endpoints}`,
    `  auth & limits  ${DOCUMENTATION.basics}`,
    "",
    "Writing an agent? `braze commands --json` returns this whole surface, plus the exit code",
    "for every kind of failure, as JSON.",
    "",
  ].join("\n")
}

/**
 * `braze production campaigns list` — the profile is the first word, and it is rewritten into
 * `--profile` before Commander sees it.
 *
 * Done here rather than by registering the command tree once per profile: that would multiply
 * `braze commands --json` by the number of profiles and make the surface an agent reads depend on
 * local configuration.
 *
 * Only a name that is actually configured is taken, so `braze campaigns list` still reaches the
 * campaigns command. `profile add` refuses a name that collides with a command, which is what
 * keeps that unambiguous rather than merely unlikely.
 */
const takeProfile = (argv: string[], options: ProgramOptions): { profile?: string; rest: string[] } => {
  const first = argv[0]
  if (first === undefined || first.startsWith("-")) return { rest: argv }

  try {
    const config = loadConfig(resolvePaths(options.env ?? process.env).config)
    if (config.profiles[first]) return { profile: first, rest: argv.slice(1) }
  } catch {
    // An unreadable config cannot make a word a profile name.
  }
  return { rest: argv }
}
