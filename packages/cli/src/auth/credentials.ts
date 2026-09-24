import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type KeyringStore, systemKeyring, writeSecurely } from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import type { CredentialStorage } from "../config/file.js"

const KEYRING_SERVICE = "brazecli"

/**
 * The keyring service name, scoped to the configuration directory whenever it is not the real one.
 *
 * The OS keyring is global: an entry is addressed by service and profile name and knows nothing
 * about which config directory asked for it. So `BRAZE_CONFIG_DIR=/tmp/x braze profile add staging`
 * looks isolated and is not — it overwrites the REAL key for `staging`. That happened here on
 * 2026-09-14 and destroyed two working keys, which cannot be read back out of a keyring.
 *
 * Deriving the service name from the directory makes a throwaway config directory a throwaway
 * keyring namespace too, so the isolation people already assume they have is real.
 */
export const keyringService = (configDir: string, env: NodeJS.ProcessEnv = process.env): string =>
  env.BRAZE_CONFIG_DIR === undefined ? KEYRING_SERVICE : `${KEYRING_SERVICE}:${configDir}`

export type CredentialSource = "environment" | "keyring" | "file"

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

const credentialsPath = (configDir: string) => join(configDir, "credentials.json")

type FileStore = Record<string, { apiKey?: string }>

const readFileStore = (configDir: string): FileStore => {
  try {
    return JSON.parse(readFileSync(credentialsPath(configDir), "utf8")) as FileStore
  } catch {
    return {}
  }
}

const writeFileStore = (configDir: string, store: FileStore): void => {
  writeSecurely(credentialsPath(configDir), `${JSON.stringify(store, null, 2)}\n`, 0o600)
}

/**
 * Environment first, then the OS keyring, then a file — the order the brief fixes.
 *
 * `auto` does not probe whether a keyring exists: it attempts the operation, and on failure warns
 * once and falls through. A probe would touch the user's keychain for nothing and could still
 * succeed where the real operation fails.
 */
export class Credentials {
  readonly #configDir: string
  readonly #storage: CredentialStorage
  readonly #keyring: KeyringStore
  readonly #env: NodeJS.ProcessEnv
  readonly #service: string
  readonly #warn: (message: string) => void
  #warned = false

  constructor(options: CredentialsOptions) {
    this.#configDir = options.configDir
    this.#storage = options.storage ?? "auto"
    this.#keyring = options.keyring ?? systemKeyring
    this.#env = options.env ?? process.env
    this.#warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`))
    this.#service = keyringService(options.configDir, this.#env)
  }

  read(profile: string): StoredCredential | undefined {
    const fromEnv = this.#env.BRAZE_API_KEY?.trim()
    if (fromEnv) return { apiKey: fromEnv, source: "environment" }

    if (this.#storage !== "file") {
      const fromKeyring = this.#tryKeyring(() => this.#keyring.get(this.#service, profile))
      if (fromKeyring) return { apiKey: fromKeyring, source: "keyring" }
    }

    const fromFile = readFileStore(this.#configDir)[profile]?.apiKey
    return fromFile ? { apiKey: fromFile, source: "file" } : undefined
  }

  write(profile: string, apiKey: string): CredentialSource {
    if (this.#storage !== "file") {
      const stored = this.#tryKeyring(() => {
        this.#keyring.set(this.#service, profile, apiKey)
        return true
      })
      if (stored) return "keyring"
    }

    const store = readFileStore(this.#configDir)
    store[profile] = { apiKey }
    writeFileStore(this.#configDir, store)
    return "file"
  }

  remove(profile: string): CredentialSource[] {
    const removed: CredentialSource[] = []

    if (this.#storage !== "file" && this.#tryKeyring(() => this.#keyring.delete(this.#service, profile))) {
      removed.push("keyring")
    }

    const store = readFileStore(this.#configDir)
    if (store[profile] !== undefined) {
      delete store[profile]
      writeFileStore(this.#configDir, store)
      removed.push("file")
    }

    return removed
  }

  #tryKeyring<T>(operation: () => T): T | undefined {
    // `keyring` was asked for explicitly, so there is no fallback to warn about — but the failure
    // is still the configuration being wrong for this machine, not an unknown crash (`CLI-12`).
    if (this.#storage === "keyring") {
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

    try {
      return operation()
    } catch (error) {
      if (!this.#warned) {
        this.#warned = true
        this.#warn(
          `the OS keyring is unavailable (${error instanceof Error ? error.message : String(error)}); ` +
            "falling back to a file in the config directory",
        )
      }
      return undefined
    }
  }
}
