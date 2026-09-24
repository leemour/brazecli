import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { FetchLike } from "@leemour/cli-core/http"
import {
  checkIsDue,
  type Installer,
  installerOf,
  isNewer,
  latestVersion,
  mayNotify,
  readUpdateState,
  writeUpdateState,
} from "@leemour/cli-core/update"
import { emptyConfig, loadConfig } from "./config/file.js"
import { resolvePaths } from "./config/paths.js"
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

/**
 * npm and pnpm are `.cmd` shims on Windows, and Node starts a `.cmd` only through a shell. The
 * words are joined rather than passed as arguments, which Node 24 deprecates alongside `shell`;
 * that is safe only because they come from `updateCommand`, never from the person typing.
 */
export const spawnPlan = ([command, ...args]: string[], platform: NodeJS.Platform = process.platform) =>
  platform === "win32"
    ? { file: [command, ...args].join(" "), args: [], shell: true }
    : { file: command as string, args, shell: false }

/** stdout stays one result: whatever the package manager prints goes to stderr. */
export const runUpdate = (argv: string[], environment: UpdateEnvironment = {}): number => {
  if (environment.spawn) return environment.spawn(argv)
  const { file, args, shell } = spawnPlan(argv)
  const { status, error } = spawnSync(file, args, { stdio: ["inherit", 2, 2], shell })
  if (error) throw new Error(`could not start ${argv[0]}: ${error.message}`)
  return status ?? 1
}

const statePath = (env: NodeJS.ProcessEnv) => join(resolvePaths(env).state, "update-check.json")

/**
 * Only what decides the output mode. Commander has not run yet, and must not run twice.
 */
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
 * The daily "a newer version exists" line, or `undefined`. Started beside the command and awaited
 * after it, so asking npm costs the command nothing; any failure is silence, never an error.
 *
 * The output mode is resolved exactly as the command resolves it — flag, `BRAZE_OUTPUT`, config,
 * terminal — so a machine mode never finds a line of prose on its stderr.
 */
export const updateNotice = async (
  argv: readonly string[],
  { environment = {}, env = process.env }: { environment?: UpdateEnvironment; env?: NodeJS.ProcessEnv } = {},
): Promise<string | undefined> => {
  try {
    const [command] = argv.filter((word) => !word.startsWith("-"))
    if (command === "complete" || command === "update") return undefined

    let config = emptyConfig()
    try {
      config = loadConfig(resolvePaths(env).config)
    } catch {
      // The command itself reports an unreadable config; the notice stays silent.
    }

    const told = mayNotify({
      format: resolveOutputFormat(
        formatFlags(argv),
        env,
        config,
        environment.stdoutIsTTY ?? process.stdout.isTTY === true,
      ),
      stderrIsTTY: environment.stderrIsTTY ?? process.stderr.isTTY === true,
      quiet: false,
      enabled: config.updateCheck ?? true,
      installer: installer(environment),
      env,
      offVariables: ["BRAZE_NO_UPDATE_CHECK"],
    })
    if (!told) return undefined

    const path = statePath(env)
    const now = (environment.now ?? Date.now)()
    let state = readUpdateState(path)
    if (checkIsDue(state, now)) {
      const found = await latestVersion(PACKAGE, environment.fetch ?? fetch, { timeoutMs: 1000 })
      const seen = found ?? state?.latest
      state = seen ? { checkedAt: now, latest: seen } : { checkedAt: now }
      writeUpdateState(path, state)
    }

    return state?.latest && isNewer(state.latest, VERSION)
      ? `braze ${state.latest} is out — you have ${VERSION}. \`braze update\` installs it.`
      : undefined
  } catch {
    return undefined
  }
}
