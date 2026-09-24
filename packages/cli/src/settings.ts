import { join } from "node:path"
import type { KeyringStore, RenderFormat } from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import { type CredentialSource, Credentials } from "./auth/credentials.js"
import { type Config, loadConfig, type OutputFormat } from "./config/file.js"
import { type Paths, resolvePaths } from "./config/paths.js"
import { firstProfileHint } from "./documentation.js"

export interface GlobalFlags {
  profile?: string
  json?: boolean
  quiet?: boolean
  output?: OutputFormat
  color?: boolean
  runsDir?: string
  timeout?: number
  retries?: number
  dryRun?: boolean
  confirm?: boolean
  paginate?: boolean
  maxPages?: number
  maxItems?: number
  records?: string
  recordsFormat?: string
  recordsField?: string
  recordId?: string
  concurrency?: number
}

export interface Settings {
  paths: Paths
  config: Config
  profileName: string
  restEndpoint: string
  readOnly: boolean
  /** The ceiling `braze profile verify` checks the workspace's size against, when one is recorded. */
  expectMaxMonthlyActives: number | undefined
  apiKey: string
  apiKeySource: CredentialSource
  outputFormat: RenderFormat
  color: boolean
  quiet: boolean
  timeoutMs: number | undefined
  retries: number | undefined
  dryRun: boolean
  confirm: boolean
  paginate: boolean
  /** Undefined means "the default ceiling", never "unbounded" — `execute.ts` supplies the number. */
  maxPages: number | undefined
  maxItems: number | undefined
  /**
   * The source of a bulk run, and the three things that say how to read it. Set means "this file
   * holds many records; batch them" — a different operation from `--input`, which sends one body
   * (`NEED-30`).
   */
  records: string | undefined
  recordsFormat: string | undefined
  recordsField: string | undefined
  recordId: string | undefined
  /** §38: four concurrent requests by default, 1–32, settable per run or in the config. */
  concurrency: number
  /** Whether stderr is a terminal. Progress needs it; colour is a separate question (`--no-color`). */
  interactive: boolean
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  isTty?: boolean
  warn?: (message: string) => void
}

/**
 * The hierarchy the brief fixes: **CLI option > environment > profile config > global config >
 * default.** One place, so no command re-derives it and gets the order subtly wrong.
 */
export const resolveSettings = (flags: GlobalFlags, options: ResolveOptions = {}): Settings => {
  const env = options.env ?? process.env
  const paths = resolvePaths(env)
  const config = loadConfig(paths.config)
  if (flags.runsDir) paths.runs = flags.runsDir

  // No default, deliberately. A default is selected by OMISSION, and the thing most easily
  // omitted should not be the workspace with a million people in it. `BRAZE_PROFILE` gives the
  // same brevity for a whole shell session without making silence mean production.
  const profileName = flags.profile ?? env.BRAZE_PROFILE
  if (!profileName) {
    const names = Object.keys(config.profiles)
    throw new BrazeError(
      "configuration_error",
      names.length === 0
        ? firstProfileHint(join(paths.config, "config.json"))
        : `no profile given. Name one first — \`braze ${names[0]} <command>\` — or set BRAZE_PROFILE ` +
            `for the session. Configured: ${names.join(", ")}. There is no default on purpose.`,
    )
  }

  const profile = config.profiles[profileName]
  const restEndpoint = env.BRAZE_REST_ENDPOINT ?? profile?.restEndpoint
  if (!restEndpoint) {
    throw new BrazeError(
      "configuration_error",
      profile
        ? `profile "${profileName}" has no REST endpoint`
        : `no profile named "${profileName}" — run \`braze profile list\` to see what exists, ` +
            `or \`braze profile add ${profileName} --endpoint <url>\`. Profiles live in ` +
            `${join(paths.config, "config.json")}`,
    )
  }

  const credentials = new Credentials({
    configDir: paths.config,
    storage: config.credentialStorage,
    keyring: options.keyring,
    env,
    warn: options.warn,
  })

  const stored = credentials.read(profileName)
  if (!stored) {
    throw new BrazeError(
      "authentication_error",
      `no API key for profile "${profileName}" — run \`braze profile add ${profileName}\`, or set BRAZE_API_KEY`,
    )
  }

  return {
    paths,
    config,
    profileName,
    restEndpoint,
    readOnly: profile?.readOnly === true,
    expectMaxMonthlyActives: profile?.expectMaxMonthlyActives,
    apiKey: stored.apiKey,
    apiKeySource: stored.source,
    records: flags.records,
    recordsFormat: flags.recordsFormat,
    recordsField: flags.recordsField,
    recordId: flags.recordId,
    concurrency: resolveConcurrency(flags, config),
    interactive: options.isTty ?? process.stderr.isTTY === true,
    outputFormat: resolveOutputFormat(flags, env, config, options.isTty ?? process.stdout.isTTY === true),
    color: resolveColor(flags, env, config, options.isTty ?? process.stderr.isTTY === true),
    quiet: flags.quiet === true,
    timeoutMs: flags.timeout ?? config.http.timeoutMs,
    retries: flags.retries ?? config.http.retries,
    dryRun: flags.dryRun === true,
    confirm: flags.confirm === true,
    paginate: flags.paginate === true,
    maxPages: flags.maxPages,
    maxItems: flags.maxItems,
  }
}

/**
 * `NEED-1`: a terminal gets the human renderer, a pipe gets JSON. Kept behind this one function
 * on purpose — if agent traffic ever makes JSON the better default everywhere, that is a
 * one-line change here rather than a rewrite of every command.
 */
export const resolveOutputFormat = (
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv,
  config: Config,
  isTty: boolean,
): RenderFormat => {
  if (flags.json) return "json"
  if (flags.output && flags.output !== "auto") return flags.output

  const fromEnv = env.BRAZE_OUTPUT
  if (fromEnv === "json" || fromEnv === "jsonl" || fromEnv === "pretty") return fromEnv

  const configured = config.output.format
  if (configured && configured !== "auto") return configured

  return isTty ? "pretty" : "json"
}

/** §38's suggested safe range, and the config field Phase 1 reserved for it. */
const DEFAULT_CONCURRENCY = 4

const resolveConcurrency = (flags: GlobalFlags, config: Config): number => {
  const given = flags.concurrency ?? config.bulk?.concurrency ?? DEFAULT_CONCURRENCY

  if (!Number.isInteger(given) || given < 1 || given > 32) {
    throw new BrazeError("validation_error", `--concurrency takes a whole number from 1 to 32, not ${given}`)
  }
  return given
}

export const resolveColor = (flags: GlobalFlags, env: NodeJS.ProcessEnv, config: Config, isTty: boolean): boolean => {
  if (flags.color === false) return false
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true

  const configured = config.output.color
  if (configured === "always") return true
  if (configured === "never") return false

  return isTty
}
