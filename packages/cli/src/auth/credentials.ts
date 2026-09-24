import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  Credentials as CoreCredentials,
  type CredentialSource,
  keyringService as coreKeyringService,
  type KeyringStore,
  writeSecurely,
} from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import type { CredentialStorage } from "../config/file.js"

export type { CredentialSource }

const KEYRING_SERVICE = "brazecli"
const FILE_NAME = "credentials.json"

/**
 * The keyring service name, scoped to the configuration directory whenever it is not the real one.
 *
 * The OS keyring is global: an entry is addressed by service and profile name and knows nothing
 * about which config directory asked for it. So `BRAZE_CONFIG_DIR=/tmp/x braze profile add staging`
 * looks isolated and is not — it overwrites the REAL key for `staging`. That happened here on
 * 2026-09-14 and destroyed two working keys, which cannot be read back out of a keyring.
 */
export const keyringService = (configDir: string, env: NodeJS.ProcessEnv = process.env): string =>
  coreKeyringService(KEYRING_SERVICE, configDir, env.BRAZE_CONFIG_DIR !== undefined)

export interface StoredCredential {
  apiKey: string
  source: CredentialSource
}

export interface CredentialsOptions {
  configDir: string
  storage?: CredentialStorage
  keyring?: KeyringStore
  env?: NodeJS.ProcessEnv
  /** Where the one-line warning goes when the keyring is unavailable. Never stdout. */
  warn?: (message: string) => void
}

/**
 * Environment (`BRAZE_API_KEY`), then the OS keyring, then a file — cli-core's order, which is the
 * one the brief fixes. The profile name is the keyring account.
 */
export class Credentials {
  readonly #core: CoreCredentials
  readonly #keyringOnly: boolean

  constructor(options: CredentialsOptions) {
    const env = options.env ?? process.env
    migrateFile(options.configDir, options.warn ?? ((message) => process.stderr.write(`${message}\n`)))
    this.#keyringOnly = options.storage === "keyring"
    this.#core = new CoreCredentials({
      configDir: options.configDir,
      service: KEYRING_SERVICE,
      isolated: env.BRAZE_CONFIG_DIR !== undefined,
      envVar: "BRAZE_API_KEY",
      fileName: FILE_NAME,
      ...(options.storage ? { storage: options.storage } : {}),
      ...(options.keyring ? { keyring: options.keyring } : {}),
      env,
      ...(options.warn ? { warn: options.warn } : {}),
    })
  }

  read(profile: string): StoredCredential | undefined {
    const stored = this.#guard(() => this.#core.read(profile))
    return stored && { apiKey: stored.secret, source: stored.source }
  }

  write(profile: string, apiKey: string): CredentialSource {
    return this.#guard(() => this.#core.write(profile, apiKey))
  }

  remove(profile: string): CredentialSource[] {
    return this.#guard(() => this.#core.remove(profile))
  }

  /**
   * `keyring` was asked for explicitly, so cli-core lets the failure through — but it is still the
   * configuration being wrong for this machine, not an unknown crash (`CLI-12`: exit 3).
   */
  #guard<T>(operation: () => T): T {
    if (!this.#keyringOnly) return operation()
    try {
      return operation()
    } catch (error) {
      throw new BrazeError(
        "configuration_error",
        `credentialStorage is "keyring" and the OS keyring is unavailable (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }
  }
}

/**
 * braze wrote `{ "<profile>": { "apiKey": … } }`; cli-core reads `secret`. Rewritten once, here,
 * rather than tolerated forever in cli-core — and before the first read, or every key saved on a
 * machine without a keyring (CI, a container) looks gone after the upgrade. `apiKey` is kept so an
 * older braze sharing the directory still finds the key.
 */
const migrateFile = (configDir: string, warn: (message: string) => void): void => {
  const path = join(configDir, FILE_NAME)
  let store: unknown
  try {
    store = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return
  }
  if (typeof store !== "object" || store === null) return

  let changed = false
  for (const entry of Object.values(store as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue
    const fields = entry as Record<string, unknown>
    if (typeof fields.apiKey === "string" && fields.secret === undefined) {
      fields.secret = fields.apiKey
      changed = true
    }
  }
  if (!changed) return

  try {
    writeSecurely(path, `${JSON.stringify(store, null, 2)}\n`, 0o600)
  } catch (error) {
    warn(
      `${path} is in the old format and cannot be rewritten (${
        error instanceof Error ? error.message : String(error)
      }); the keys in it cannot be read until it can`,
    )
  }
}
