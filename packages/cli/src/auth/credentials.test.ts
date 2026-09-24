import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring, memoryKeyring } from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import { describe, expect, it, vi } from "vitest"
import { Credentials, keyringService } from "./credentials.js"

const tempDir = () => mkdtempSync(join(tmpdir(), "brazecli-creds-"))

// Every test here injects a keyring. Nothing in this suite can reach a real keychain.
const credentials = (overrides: Partial<ConstructorParameters<typeof Credentials>[0]> = {}) =>
  new Credentials({ configDir: tempDir(), keyring: memoryKeyring(), env: {}, warn: () => {}, ...overrides })

describe("credential resolution", () => {
  it("puts the environment ahead of everything else", () => {
    const keyring = memoryKeyring({ "brazecli:production": "from-keyring" })

    const found = credentials({ keyring, env: { BRAZE_API_KEY: "from-env" } }).read("production")

    expect(found).toEqual({ apiKey: "from-env", source: "environment" })
  })

  it("prefers the keyring over the file", () => {
    const dir = tempDir()
    const keyring = memoryKeyring()
    const store = new Credentials({ configDir: dir, keyring, env: {}, warn: () => {} })

    store.write("production", "k1")

    expect(store.read("production")).toEqual({ apiKey: "k1", source: "keyring" })
  })

  it("finds nothing rather than throwing when a profile has no key", () => {
    expect(credentials().read("staging")).toBeUndefined()
  })
})

describe("when the keyring cannot be used", () => {
  it("warns once, on stderr, and writes a file instead", () => {
    const dir = tempDir()
    const warn = vi.fn()
    const store = new Credentials({ configDir: dir, keyring: brokenKeyring(), env: {}, warn })

    expect(store.write("production", "k1")).toBe("file")
    expect(store.read("production")).toEqual({ apiKey: "k1", source: "file" })
    // Two operations, one warning — a per-call warning would bury the output of a bulk run.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/keyring is unavailable/)
  })

  it("writes that file so only its owner can read it", () => {
    const dir = tempDir()
    new Credentials({ configDir: dir, keyring: brokenKeyring(), env: {}, warn: () => {} }).write("production", "k1")

    expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600)
  })

  it("does not fall back at all when storage is pinned to the keyring", () => {
    const store = new Credentials({ configDir: tempDir(), storage: "keyring", keyring: brokenKeyring(), env: {} })

    expect(() => store.write("production", "k1")).toThrow(/no secret service/)
  })

  it("calls a pinned keyring that cannot work a configuration error, not an unknown crash", () => {
    const store = new Credentials({ configDir: tempDir(), storage: "keyring", keyring: brokenKeyring(), env: {} })

    try {
      store.write("production", "k1")
      expect.unreachable("the write should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(BrazeError)
      expect((error as BrazeError).code).toBe("configuration_error")
    }
  })

  it("skips the keyring entirely when storage is pinned to file", () => {
    const keyring = memoryKeyring()
    const store = new Credentials({ configDir: tempDir(), storage: "file", keyring, env: {}, warn: () => {} })

    store.write("production", "k1")

    expect(keyring.entries.size).toBe(0)
  })
})

describe("removal", () => {
  it("takes the key out of both places and says which", () => {
    const dir = tempDir()
    const keyring = memoryKeyring()
    const store = new Credentials({ configDir: dir, keyring, env: {}, warn: () => {} })

    store.write("production", "k1")
    expect(store.remove("production")).toEqual(["keyring"])
    expect(store.read("production")).toBeUndefined()
  })

  it("keeps other profiles when one is removed", () => {
    const dir = tempDir()
    const store = new Credentials({ configDir: dir, storage: "file", keyring: memoryKeyring(), env: {} })

    store.write("production", "k1")
    store.write("staging", "k2")
    store.remove("production")

    expect(JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8"))).toEqual({ staging: { apiKey: "k2" } })
  })
})

// 2026-09-14: `BRAZE_CONFIG_DIR=/tmp/x braze profile add staging` looked isolated and was not —
// the OS keyring is global, so it overwrote the real key for `staging`. Two working keys were
// destroyed, and a keyring cannot be read back to recover them.
describe("keyring namespacing", () => {
  it("uses the plain service name when the config directory is the real one", () => {
    expect(keyringService("/home/someone/.config/brazecli", {})).toBe("brazecli")
  })

  it("scopes the service name when BRAZE_CONFIG_DIR points somewhere else", () => {
    const service = keyringService("/tmp/throwaway", { BRAZE_CONFIG_DIR: "/tmp/throwaway" })

    expect(service).not.toBe("brazecli")
    expect(service).toContain("/tmp/throwaway")
  })
})
