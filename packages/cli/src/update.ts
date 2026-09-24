import { realpathSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { FetchLike } from "@leemour/cli-core/http"
import {
  type Installer,
  installerOf,
  latestVersion,
  runUpdate as runPackageManager,
  updateNotice as sharedNotice,
} from "@leemour/cli-core/update"
import { resolvePaths } from "./config/paths.js"
import { readableConfig } from "./output/context.js"
import { type GlobalFlags, resolveOutputFormat } from "./settings.js"
import { VERSION } from "./version.js"

export const PACKAGE = "@leemour/brazecli"

/** npm, the clock, the terminal and the package manager as `braze update` sees them — faked in a test. */
export interface UpdateEnvironment {
  fetch?: FetchLike
  now?: () => number
  stdoutIsTTY?: boolean
  stderrIsTTY?: boolean
  scriptPath?: string
  /** Runs the update and answers its exit code; its output goes to stderr. */
  spawn?: (argv: string[]) => number
}

export const installer = ({ scriptPath }: UpdateEnvironment = {}): Installer =>
  installerOf(scriptPath ?? realpathSync(fileURLToPath(import.meta.url)))

export const latest = (environment: UpdateEnvironment = {}) =>
  latestVersion(PACKAGE, environment.fetch ?? fetch, { timeoutMs: 3000 })

/** The package manager's output goes to stderr, so stdout stays one result. */
export const runUpdate = (argv: string[], environment: UpdateEnvironment = {}): number =>
  environment.spawn ? environment.spawn(argv) : runPackageManager(argv)

const statePath = (env: NodeJS.ProcessEnv) => join(resolvePaths(env).state, "update-check.json")

/** Only what decides the output mode: Commander has not parsed the command line yet. */
const formatFlags = (argv: readonly string[]): GlobalFlags => {
  const at = argv.findIndex((word) => word === "--output" || word.startsWith("--output="))
  const word = argv[at]
  const output = word?.includes("=") ? word.split("=")[1] : argv[at + 1]
  return {
    json: argv.includes("--json"),
    ...(at === -1 ? {} : { output: output as GlobalFlags["output"] }),
  }
}

/**
 * The daily "a newer version exists" line, or `undefined`. The output mode is resolved exactly as
 * the command resolves it — flag, `BRAZE_OUTPUT`, config, terminal — so a machine mode never finds
 * a line of prose on its stderr.
 */
export const updateNotice = (
  argv: readonly string[],
  { environment = {}, env = process.env }: { environment?: UpdateEnvironment; env?: NodeJS.ProcessEnv } = {},
): Promise<string | undefined> => {
  try {
    const config = readableConfig(env)
    return sharedNotice({
      argv,
      packageName: PACKAGE,
      command: "braze",
      version: VERSION,
      statePath: statePath(env),
      fetch: environment.fetch ?? fetch,
      ...(environment.now ? { now: environment.now } : {}),
      format: resolveOutputFormat(
        formatFlags(argv),
        env,
        config,
        environment.stdoutIsTTY ?? process.stdout.isTTY === true,
      ),
      stderrIsTTY: environment.stderrIsTTY ?? process.stderr.isTTY === true,
      quiet: argv.includes("--quiet"),
      enabled: config.updateCheck ?? true,
      installer: installer(environment),
      env,
      offVariables: ["BRAZE_NO_UPDATE_CHECK"],
    })
  } catch {
    return Promise.resolve(undefined)
  }
}
