import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { beforeEach, describe, expect, it } from "vitest"
import { keyringService } from "../auth/credentials.js"
import { run } from "../program.js"

let configDir: string
let keyring: ReturnType<typeof memoryKeyring>
let streams: ReturnType<typeof captureStreams>

const braze = (argv: string[], env: NodeJS.ProcessEnv = {}) =>
  run(argv, { env: { BRAZE_CONFIG_DIR: configDir, ...env }, keyring, streams })

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-profile-"))
  keyring = memoryKeyring()
  streams = captureStreams()
})

describe("braze profile", () => {
  it("adds a profile and puts the key in the keyring", async () => {
    const code = await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "prod-key",
    })

    expect(code).toBe(0)
    expect(keyring.entries.get(`${keyringService(configDir, { BRAZE_CONFIG_DIR: configDir })}:production`)).toBe(
      "prod-key",
    )
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({
      profile: "production",
      restEndpoint: "https://rest.fra-01.braze.eu",
      readOnly: false,
      keyStoredIn: "keyring",
      keyChanged: true,
    })
  })

  // BUG-5 and UX-3. Updating one field used to mean re-supplying every field, and the endpoint
  // got retyped as `rest.fra-01.braze.com` — a host that does not exist, so nothing worked at
  // all until someone noticed.
  describe("updating one field of an existing profile", () => {
    const add = (args: string[]) => braze(["profile", "add", "production", ...args], { BRAZE_API_KEY: "prod-key" })
    const written = () => JSON.parse(streams.stdout.join("\n").trim().split("\n").at(-1) as string)

    beforeEach(async () => {
      await add(["--endpoint", "https://rest.fra-01.braze.eu", "--read-only"])
      streams.stdout.length = 0
    })

    it("turns writes back on without being told the endpoint again", async () => {
      expect(await add(["--no-read-only"])).toBe(0)
      expect(written()).toMatchObject({ restEndpoint: "https://rest.fra-01.braze.eu", readOnly: false })
    })

    it("turns them off again", async () => {
      await add(["--no-read-only"])
      streams.stdout.length = 0

      expect(await add(["--read-only"])).toBe(0)
      expect(written()).toMatchObject({ readOnly: true })
    })

    it("does NOT silently unlock writes when only the endpoint is corrected", async () => {
      expect(await add(["--endpoint", "https://rest.fra-02.braze.eu"])).toBe(0)
      expect(written()).toMatchObject({ restEndpoint: "https://rest.fra-02.braze.eu", readOnly: true })
    })

    it("still demands an endpoint for a profile that does not exist yet", async () => {
      const code = await braze(["profile", "add", "brand-new"], { BRAZE_API_KEY: "k" })

      expect(code).toBe(2)
      expect(streams.stderr.join("\n")).toMatch(/needs --endpoint/)
    })
  })

  it("never writes the key into the config file", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "prod-key",
    })

    expect(readFileSync(join(configDir, "config.json"), "utf8")).not.toContain("prod-key")
  })

  // NEED-25: no profile is ever the default, so nothing is reached by omission. The config
  // field that once held one was removed in DEBT-2; this guards against it coming back.
  it("makes no profile the default, whichever was created first", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "k",
    })

    expect(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).defaultProfile).toBeUndefined()
  })

  it("refuses a profile named after a command, which `braze <profile> …` would make ambiguous", async () => {
    const code = await braze(["profile", "add", "users", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "k",
    })

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toMatch(/would be ambiguous/)
  })

  it("lists profiles without ever printing a key, masked or otherwise", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "super-secret-key",
    })
    streams.stdout.length = 0

    await braze(["profile", "list"])

    const output = streams.stdout.join("\n")
    // A masked key still confirms which key is installed, so neither the value nor any part of
    // it appears — only whether one exists and where it lives.
    expect(output).not.toContain("super-secret")
    expect(output).not.toContain("secret")
    expect(JSON.parse(output).profiles[0]).toMatchObject({
      name: "production",
      apiKey: { present: true, source: "keyring" },
    })
  })

  // BUG-17: add, list and remove wrote JSON to stdout directly, so NEED-1 held everywhere in the
  // program except the three commands a newcomer runs first.
  it("renders a table when the format asks for one, like every other command", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "prod-key",
    })
    streams.stdout.length = 0

    await braze(["--output", "pretty", "profile", "list"])

    const output = streams.stdout.join("\n")
    expect(() => JSON.parse(output)).toThrow()
    expect(output).toMatch(/name\s+restEndpoint/)
    expect(output).toContain("production")
  })

  it("keeps the stored key when re-run only to correct the endpoint", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.XXX.braze.YYY"], { BRAZE_API_KEY: "k" })
    streams.stdout.length = 0

    const code = await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"])

    expect(code).toBe(0)
    expect(keyring.entries.get(`${keyringService(configDir, { BRAZE_CONFIG_DIR: configDir })}:production`)).toBe("k")
    expect(JSON.parse(streams.stdout.join("\n"))).toMatchObject({
      restEndpoint: "https://rest.fra-01.braze.eu",
      keyChanged: false,
    })
    expect(streams.stderr.join("\n")).toMatch(/keeping the key already in the keyring/)
  })

  it("removes a profile and its key", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], { BRAZE_API_KEY: "k" })

    const code = await braze(["profile", "remove", "production"])

    expect(code).toBe(0)
    expect(keyring.entries.size).toBe(0)
    expect(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).profiles).toEqual({})
  })

  it("exits not_found when asked to remove something that is not there", async () => {
    expect(await braze(["profile", "remove", "nope"])).toBe(6)
    expect(streams.stderr.join("\n")).toMatch(/not_found/)
  })

  it("refuses to invent a key when there is no terminal and no environment", async () => {
    const code = await run(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
    })

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toMatch(/BRAZE_API_KEY/)
  })

  it("keeps diagnostics off stdout — stdout is data, always", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], { BRAZE_API_KEY: "k" })

    expect(() => JSON.parse(streams.stdout.join("\n"))).not.toThrow()
    expect(streams.stderr.join("\n")).toMatch(/key stored in the keyring/)
  })
})

describe("giving the key to a machine that has no terminal", () => {
  const stored = (profile: string) =>
    keyring.entries.get(`${keyringService(configDir, { BRAZE_CONFIG_DIR: configDir })}:${profile}`)

  /**
   * `CLI-15`. Before this, a CI with neither a TTY nor `BRAZE_API_KEY` in the environment simply
   * could not configure a profile — and this CLI is built for automation first.
   */
  it("takes the key from standard input when asked to", async () => {
    const code = await run(["profile", "add", "staging", "--endpoint", "https://rest.fra-01.braze.eu", "--key-stdin"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
      readStdin: () => "piped-key",
    })

    expect(code).toBe(0)
    expect(stored("staging")).toBe("piped-key")
  })

  /** `echo "$KEY" |` adds a newline, and a key with one in it fails auth in a way that reads as a wrong key. */
  it("trims what it was given", async () => {
    await run(["profile", "add", "staging", "--endpoint", "https://rest.fra-01.braze.eu", "--key-stdin"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
      readStdin: () => "piped-key\n",
    })

    expect(stored("staging")).toBe("piped-key")
  })

  /** Asked for in this invocation beats left over in the shell. */
  it("prefers what was piped in over BRAZE_API_KEY", async () => {
    await run(["profile", "add", "staging", "--endpoint", "https://rest.fra-01.braze.eu", "--key-stdin"], {
      env: { BRAZE_CONFIG_DIR: configDir, BRAZE_API_KEY: "from-the-environment" },
      keyring,
      streams,
      readStdin: () => "piped-key",
    })

    expect(stored("staging")).toBe("piped-key")
  })

  it("says so plainly when the pipe was empty, rather than inventing a key", async () => {
    const code = await run(["profile", "add", "staging", "--endpoint", "https://rest.fra-01.braze.eu", "--key-stdin"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
      readStdin: () => "   ",
    })

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toMatch(/standard input was empty/)
  })

  it("never echoes the key it was given", async () => {
    await run(["profile", "add", "staging", "--endpoint", "https://rest.fra-01.braze.eu", "--key-stdin"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
      readStdin: () => "secret-key",
    })

    expect([...streams.stdout, ...streams.stderr].join("\n")).not.toContain("secret-key")
  })

  it("points at the pipe when there is no key anywhere", async () => {
    const code = await run(["profile", "add", "staging", "--endpoint", "https://rest.fra-01.braze.eu"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
    })

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toMatch(/--key-stdin/)
  })
})
