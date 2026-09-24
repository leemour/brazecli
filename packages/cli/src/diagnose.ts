import { existsSync } from "node:fs"
import { join } from "node:path"
import { configFilePath, type KeyringStore } from "@leemour/cli-core"
import { isNewer, readUpdateState } from "@leemour/cli-core/update"
import { type CredentialSource, Credentials, keyringService } from "./auth/credentials.js"
import { type Config, emptyConfig, loadConfig } from "./config/file.js"
import { resolvePaths } from "./config/paths.js"
import { listRuns } from "./runs/run.js"
import { installer, type UpdateEnvironment } from "./update.js"
import { VERSION } from "./version.js"

export interface DiagnoseOptions {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  update?: UpdateEnvironment
}

export interface ProfileDiagnosis {
  name: string
  restEndpoint: string
  readOnly: boolean
  /** ⚠ Whether a key is reachable and from where — never the key, a prefix of it or its length. */
  apiKey: { present: boolean; source?: CredentialSource; problem?: string }
}

export interface Diagnosis {
  version: string
  installer: string
  /** What npm said the last time it was asked. Read from the state file; npm is not asked here. */
  update: { lastCheckedAt: string | null; latest: string | null; newer: boolean }
  config: { file: string; found: boolean; valid: boolean; problem?: string }
  /**
   * ⚠ `BRAZE_CONFIG_DIR` changes the keyring entries a profile means, so a key stored with it set
   * reads as missing without it — and nothing else in the tool shows that.
   */
  keyring: { service: string; isolated: boolean }
  environment: { BRAZE_API_KEY: boolean; BRAZE_PROFILE: string | null; BRAZE_REST_ENDPOINT: string | null }
  profiles: ProfileDiagnosis[]
  runs: { directory: string; kept: number }
  /** What to do next, in the order it matters. */
  next: string[]
}

/**
 * Everything a command depends on, read from this machine and **never from Braze or npm**.
 *
 * ⚠ It must work when everything is broken, because that is when it is run: no config, an invalid
 * one, a keyring that will not open. Each of those is a field in the answer, never an exception.
 */
export const diagnose = ({ env = process.env, keyring, update = {} }: DiagnoseOptions = {}): Diagnosis => {
  const paths = resolvePaths(env)
  const file = configFilePath(paths.config)
  const next: string[] = []

  let config: Config = emptyConfig()
  let problem: string | undefined
  try {
    config = loadConfig(paths.config)
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error)
    next.push(`fix or move ${file}: every command that needs a profile fails until then`)
  }

  const warnings: string[] = []
  const credentials = new Credentials({
    configDir: paths.config,
    storage: config.credentialStorage,
    ...(keyring ? { keyring } : {}),
    env,
    warn: (message) => warnings.push(message),
  })

  const profiles = Object.entries(config.profiles).map(([name, profile]): ProfileDiagnosis => {
    let apiKey: ProfileDiagnosis["apiKey"]
    try {
      const stored = credentials.read(name)
      apiKey = stored ? { present: true, source: stored.source } : { present: false }
    } catch (error) {
      apiKey = { present: false, problem: error instanceof Error ? error.message : String(error) }
    }
    if (!apiKey.present) next.push(`profile "${name}" has no key: \`braze profile add ${name}\` stores one`)
    return { name, restEndpoint: profile.restEndpoint, readOnly: profile.readOnly === true, apiKey }
  })
  next.push(...warnings)

  if (!problem && profiles.length === 0) next.push("no profile yet: `braze profile add <name> --endpoint <url>`")

  const isolated = env.BRAZE_CONFIG_DIR !== undefined
  if (isolated) next.push("BRAZE_CONFIG_DIR is set, so keys stored now are separate from the ones stored without it")

  const state = readUpdateState(join(paths.state, "update-check.json"))
  const newer = state?.latest !== undefined && isNewer(state.latest, VERSION)
  if (newer) next.push(`braze ${state?.latest} is out: \`braze update\``)

  return {
    version: VERSION,
    installer: installer(update),
    update: {
      lastCheckedAt: state ? new Date(state.checkedAt).toISOString() : null,
      latest: state?.latest ?? null,
      newer,
    },
    config: { file, found: existsSync(file), valid: problem === undefined, ...(problem ? { problem } : {}) },
    keyring: { service: keyringService(paths.config, env), isolated },
    environment: {
      BRAZE_API_KEY: (env.BRAZE_API_KEY ?? "").trim() !== "",
      BRAZE_PROFILE: env.BRAZE_PROFILE ?? null,
      BRAZE_REST_ENDPOINT: env.BRAZE_REST_ENDPOINT ?? null,
    },
    profiles,
    runs: { directory: paths.runs, kept: listRuns(paths.runs).length },
    next,
  }
}
