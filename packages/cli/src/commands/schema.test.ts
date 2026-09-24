import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { catalog } from "brazecli-core"
import { beforeEach, describe, expect, it } from "vitest"
import { run } from "../program.js"

let configDir: string
let streams: ReturnType<typeof captureStreams>

/**
 * No profile, no key, no `BRAZE_PROFILE` — deliberately. `schema` talks to Braze not at all, and
 * the handoff warns that a test which merely calls a command now fails with `configuration_error`
 * unless a profile is set. That this one does not is the point of the first test below.
 */
const schema = async (argv: string[]) => {
  const code = await run(argv, { env: { BRAZE_CONFIG_DIR: configDir }, streams, isTty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-schema-"))
  streams = captureStreams()
})

describe("braze schema", () => {
  it("needs no profile, because it never talks to Braze (NEED-25)", async () => {
    const { code, stdout, stderr } = await schema(["schema", "campaigns", "list", "--json"])

    expect(code).toBe(0)
    expect(stderr).not.toContain("configuration_error")
    expect(JSON.parse(stdout).id).toBe("campaigns.list.get")
  })

  // The two discovery surfaces speak different languages: `commands --json` hands an agent command
  // words, while the coverage doc and the overrides are keyed by id. Both have to resolve.
  it("resolves the same operation from command words and from an id", async () => {
    const words = await schema(["schema", "campaigns", "list", "--json"])
    streams = captureStreams()
    const id = await schema(["schema", "campaigns.list.get", "--json"])

    expect(JSON.parse(words.stdout)).toEqual(JSON.parse(id.stdout))
  })

  it("says what a call needs: the flags, whether it writes, and where to send it", async () => {
    const { stdout } = await schema(["schema", "catalogs.by-id.items.by-id.get", "--json"])
    const described = JSON.parse(stdout)

    expect(described.method).toBe("GET")
    expect(described.path).toBe("/catalogs/{catalog_name}/items/{item_id}")
    expect(described.pathParameters).toEqual(["catalog_name", "item_id"])
    expect(described.usage).toContain("--catalog-name <value>")
    expect(described.confirmationRequired).toBe(false)
  })

  // Computed from access at print time rather than stored on the operation: `assertWriteAllowed`
  // already derives it, and two sources of truth for "may this be sent" is how one goes wrong.
  it("tells an agent it will need --confirm before it earns a confirmation_required", async () => {
    const { stdout } = await schema(["schema", "users", "track", "--json"])
    const described = JSON.parse(stdout)

    expect(described.confirmationRequired).toBe(true)
    expect(described.usage).toContain("--confirm")
    expect(described.batch).toEqual({ attributes: 75, events: 75, purchases: 75 })
  })

  it("names an unknown operation as a validation error and points at near misses", async () => {
    const { code, stdout, stderr } = await schema(["schema", "campaign", "list", "--json"])

    expect(code).not.toBe(0)
    // Rule 3: stdout is data, and a refusal is not data.
    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("validation_error")
    expect(JSON.parse(stderr).error.message).toContain("campaigns list")
  })
})

describe("the request body braze schema reports", () => {
  it("hands over a real example as something that can be sent", async () => {
    const { stdout } = await schema(["schema", "users", "track", "--json"])
    const body = JSON.parse(stdout).requestBody

    expect(body.source).toBe("example")
    expect(Object.keys(body.example)).toContain("attributes")
    // It is an example, not a contract — saying so is what stops an agent treating it as one.
    expect(body.note).toContain("not a schema")
  })

  /**
   * FIND-17: 16 of Braze's 48 documented bodies are prose in the value position —
   * `"name": (required, string) Must be less than 100 characters,`. Sending that would be
   * nonsense, so the flavour travels with the text and the note says which it is.
   */
  it("marks Braze's annotated prose as prose, rather than passing it off as a payload", async () => {
    const { stdout } = await schema(["schema", "subscription.status.set.create", "--json"])
    const body = JSON.parse(stdout).requestBody

    expect(body.source).toBe("annotated")
    expect(body.example).toBeUndefined()
    expect(body.text).toContain("(required, string)")
    expect(body.note).toContain("do not send it")
  })

  it("says plainly when Braze documents no body at all", async () => {
    const { stdout } = await schema(["schema", "campaigns", "list", "--json"])

    expect(JSON.parse(stdout).requestBody.source).toBe("none")
  })

  it("carries a body for every operation the collection documents one for", () => {
    const documented = catalog.filter((operation) => operation.requestBody)
    const flavours = documented.reduce<Record<string, number>>((counts, operation) => {
      const source = operation.requestBody?.source as string
      counts[source] = (counts[source] ?? 0) + 1
      return counts
    }, {})

    // 48 raw bodies across 99 requests; two belong to the duplicate requests FIND-15 merges away.
    expect(flavours).toEqual({ example: 32, annotated: 14 })
  })
})
