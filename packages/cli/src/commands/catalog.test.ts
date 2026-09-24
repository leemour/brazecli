import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { catalog } from "brazecli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { beforeEach, describe, expect, it } from "vitest"
import { emptyConfig, saveConfig } from "../config/file.js"
import { DEFAULT_MAX_PAGES } from "../execute.js"
import { run } from "../program.js"

let configDir: string
let runsDir: string
let streams: ReturnType<typeof captureStreams>

const braze = (argv: string[], mock: ReturnType<typeof mockBraze>, readOnly = false) => {
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.iad-01.braze.com", readOnly }
  saveConfig(configDir, config)

  return run(argv, {
    env: {
      BRAZE_CONFIG_DIR: configDir,
      BRAZE_RUNS_DIR: runsDir,
      BRAZE_API_KEY: "test-key",
      BRAZE_PROFILE: "production",
    },
    keyring: memoryKeyring(),
    streams,
    isTty: false,
    fetch: mock.fetch,
  })
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-cat-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-catruns-"))
  streams = captureStreams()
})

describe("commands generated from the catalog", () => {
  it("sends the request the catalog describes — the phase's done criterion", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [{ id: "c1" }] }))

    const code = await braze(["campaigns", "list", "--json"], mock)

    expect(code).toBe(0)
    expect(mock.requests[0]?.url).toContain("/campaigns/list")
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({ campaigns: [{ id: "c1" }] })
  })

  it("turns a path placeholder into a required named option and substitutes it", async () => {
    const mock = mockBraze(brazeResponses.ok({ items: [] }))

    const code = await braze(["catalogs", "items", "list", "--catalog-name", "my-catalog", "--json"], mock)

    expect(code).toBe(0)
    expect(mock.requests[0]?.url).toContain("/catalogs/my-catalog/items")
  })

  it("refuses to run when a required path placeholder is missing", async () => {
    const mock = mockBraze(brazeResponses.ok({}))

    expect(await braze(["catalogs", "items", "list", "--json"], mock)).not.toBe(0)
    expect(mock.requests).toHaveLength(0)
  })

  it("passes a documented query parameter under the name Braze uses, brackets and all", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [] }))

    await braze(["campaigns", "list", "--last-edit-time-gt", "2020-06-28", "--page", "2", "--json"], mock)

    expect(mock.requests[0]?.url).toContain("last_edit.time%5Bgt%5D=2020-06-28")
    expect(mock.requests[0]?.url).toContain("page=2")
  })

  it("still takes --query, because Postman's examples are not the whole list of parameters", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [] }))

    await braze(["campaigns", "list", "--query", "undocumented=1", "--json"], mock)

    expect(mock.requests[0]?.url).toContain("undocumented=1")
  })

  it("obeys the read-only profile exactly as `braze api` does", async () => {
    const mock = mockBraze(brazeResponses.created())
    // A body that passes validation, so the read-only guard is what refuses this and not the
    // schema — CORE-10 validates before the guards, so an invalid body would mask what is tested.
    const body = '{"attributes":[{"external_id":"u1"}]}'

    const code = await braze(["users", "track", "--input", body, "--confirm", "--json"], mock, true)

    expect(code).toBe(5)
    expect(mock.requests).toHaveLength(0)
  })

  // §550 of the brief: a dry run validates. It is the one command whose whole purpose is "tell me
  // whether this would work", so answering "probably" would make it useless.
  it("validates on a dry run, which is the command that exists to answer exactly that", async () => {
    const mock = mockBraze(brazeResponses.created())

    const code = await braze(["users", "track", "--input", "{}", "--dry-run", "--json"], mock)

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toContain("at least one of attributes")
    expect(mock.requests).toHaveLength(0)
  })

  /**
   * CORE-10 §3.7. Validation runs before the write guards on purpose: `--dry-run` is the tool you
   * reach for on a locked-down profile, and answering `permission_error` while never mentioning
   * that the body was malformed answers a question nobody asked. Both refusals cost nothing.
   */
  it("names a malformed body before it names the profile, since neither sends anything", async () => {
    const mock = mockBraze(brazeResponses.created())

    const code = await braze(["users", "track", "--input", "{}", "--confirm", "--json"], mock, true)

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toContain("at least one of attributes")
    expect(mock.requests).toHaveLength(0)
  })

  it("lets a POST-shaped read through on a read-only profile, because an override says it is a read", async () => {
    const mock = mockBraze(brazeResponses.created())

    const code = await braze(["users", "export", "ids", "--input", '{"external_ids":[]}', "--json"], mock, true)

    expect(code).toBe(0)
    expect(mock.requests).toHaveLength(1)
  })
})

describe("paging", () => {
  // Braze returns a page with no total and no "next" marker, so a full page and the last page
  // look identical. Only the catalog's page size tells them apart.
  it("says a full page is probably not the whole list", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` })) }))

    await braze(["campaigns", "list", "--json"], mock)

    expect(streams.stderr.join("\n")).toContain("a full page")
    expect(streams.stderr.join("\n")).toContain("--page 1")
  })

  it("says so when the page is short", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [{ id: "c1" }] }))

    await braze(["campaigns", "list", "--json"], mock)

    expect(streams.stderr.join("\n")).toContain("last page")
  })

  it("stays quiet for an operation that is not paged", async () => {
    const mock = mockBraze(brazeResponses.ok({ catalogs: [] }))

    await braze(["catalogs", "get", "--json"], mock)

    expect(streams.stderr.join("\n")).not.toContain("page")
  })
})

describe("the shape of the generated command tree", () => {
  it("gives no command a name that is also a group, which Commander refuses outright", () => {
    const names = catalog.map((operation) => operation.command.join(" "))

    for (const name of names) {
      expect(
        names.filter((other) => other.startsWith(`${name} `)),
        name,
      ).toHaveLength(0)
    }
  })

  it("keeps the id's disambiguation marker out of the words a person types", () => {
    expect(catalog.filter((operation) => operation.command.includes("by-id"))).toHaveLength(0)
  })

  /**
   * CAT-9. The same failure as the group/leaf collision above, across the seam between the
   * handwritten commands and the generated ones: `program.ts` adds the catalog AFTER `profile`,
   * `api`, `runs` and `commands`, so a catalog operation claiming one of those names would
   * shadow it rather than error. `profile add` already refuses a profile named after a command
   * (NEED-25); this is the other half of the same guarantee.
   */
  it("claims no top-level name the handwritten commands already own", () => {
    const handwritten = new Set(["api", "profile", "runs", "commands", "schema", "help"])
    const claimed = catalog.map((operation) => operation.command[0]).filter((word) => handwritten.has(word as string))

    expect(claimed).toEqual([])
  })

  /**
   * UX-6. Braze's SCIM paths carry the capital the SCIM spec requires — `/scim/v2/Users` — and
   * passing that through to the command made `braze scim v2 users list` print the group's help
   * instead of running: Commander matches case-sensitively and answers a near miss with help
   * rather than an error, so the wrong spelling failed silently. The path keeps Braze's casing.
   */
  it("gives every command a name that can be typed in lower case, whatever Braze's path looks like", () => {
    for (const operation of catalog) {
      expect(operation.command.join(" "), operation.id).toBe(operation.command.join(" ").toLowerCase())
    }

    const scim = catalog.find((operation) => operation.id === "scim.v2.users.get")
    expect(scim?.command).toEqual(["scim", "v2", "users", "list"])
    expect(scim?.path).toBe("/scim/v2/Users")
  })
})

/**
 * CAT-11. Braze pages with a bare `page` number and gives no total and no "next" marker, so a walk
 * has to decide for itself when to stop — and must always stop.
 */
describe("--paginate", () => {
  /** A full page of 100 campaigns, so the walk has a reason to ask for another. */
  const fullPage = (n: number) =>
    brazeResponses.ok({ campaigns: Array.from({ length: 100 }, (_, i) => ({ id: `p${n}-${i}` })), message: "success" })
  const shortPage = brazeResponses.ok({ campaigns: [{ id: "last" }], message: "success" })

  it("returns every page as ONE json value, in Braze's own shape", async () => {
    const mock = mockBraze([fullPage(0), fullPage(1), shortPage])

    const code = await braze(["campaigns", "list", "--paginate", "--json"], mock)

    expect(code).toBe(0)
    const data = JSON.parse(streams.stdout.join("\n"))
    expect(mock.requests).toHaveLength(3)
    expect(data.campaigns).toHaveLength(201)
    // The shape Braze returned, with no page count injected into it — that goes to stderr.
    expect(Object.keys(data).sort()).toEqual(["campaigns", "message"])
    expect(streams.stderr.join("\n")).toContain("3 pages")
  })

  it("asks for each page in turn, starting at the one it was given", async () => {
    const mock = mockBraze([fullPage(5), shortPage])

    await braze(["campaigns", "list", "--paginate", "--page", "5", "--json"], mock)

    expect(mock.requests[0]?.url).toContain("page=5")
    expect(mock.requests[1]?.url).toContain("page=6")
  })

  it("stops at --max-pages and says so, rather than walking to the end", async () => {
    const mock = mockBraze((_request, index) => fullPage(index))

    await braze(["campaigns", "list", "--paginate", "--max-pages", "2", "--json"], mock)

    expect(mock.requests).toHaveLength(2)
    expect(streams.stderr.join("\n")).toContain("--max-pages 2")
  })

  // The one that matters: a mistyped filter must not become nine hundred requests to production.
  it("stops at a default ceiling when no bound was given at all", async () => {
    const mock = mockBraze((_request, index) => fullPage(index))

    await braze(["campaigns", "list", "--paginate", "--json"], mock)

    expect(mock.requests).toHaveLength(DEFAULT_MAX_PAGES)
    expect(streams.stderr.join("\n")).toContain("default ceiling")
  })

  it("stops once --max-items rows are collected", async () => {
    const mock = mockBraze((_request, index) => fullPage(index))

    await braze(["campaigns", "list", "--paginate", "--max-items", "150", "--json"], mock)

    expect(mock.requests).toHaveLength(2)
    expect(streams.stderr.join("\n")).toContain("--max-items 150")
  })

  it("refuses on an operation that does not page, rather than quietly ignoring the flag", async () => {
    const mock = mockBraze(brazeResponses.ok({ catalogs: [] }))

    const code = await braze(["catalogs", "get", "--paginate", "--json"], mock)

    expect(code).not.toBe(0)
    expect(mock.requests).toHaveLength(0)
    expect(streams.stderr.join("\n")).toContain("not paged")
  })

  /**
   * Braze answers `{"campaigns":[…],"message":"success"}`, so one array key is the row list. Two
   * array keys and there is no way to tell which is which — guessing would silently return a
   * fraction of the data, so it refuses and names them.
   */
  it("refuses to guess when a response carries two lists", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [{ id: "a" }], warnings: [{ code: "x" }] }))

    const code = await braze(["campaigns", "list", "--paginate", "--json"], mock)

    expect(code).not.toBe(0)
    expect(streams.stderr.join("\n")).toContain("more than one list")
  })
})

/**
 * Braze documents no page size for `/purchases/product_list` or `/feed/list`, so there is no way
 * to tell a full page from the last one. Verified live against the sandbox on 2026-09-14: both
 * answer `{<rows>: [...], "message": ...}` and neither documents a size.
 */
describe("paging an endpoint whose page size Braze does not document", () => {
  it("still says which page and how many rows, without claiming to know the end", async () => {
    const mock = mockBraze(brazeResponses.ok({ products: ["a", "b"], message: "success" }))

    await braze(["purchases", "product-list", "--json"], mock)

    const note = streams.stderr.join("\n")
    expect(note).toContain("page 0 · 2 rows")
    expect(note).toContain("no page size")
    // The claim it cannot support, and must not make.
    expect(note).not.toContain("last page")
  })

  it("calls an empty page empty, which is the one thing it can conclude", async () => {
    const mock = mockBraze(brazeResponses.ok({ products: [], message: "success" }))

    await braze(["purchases", "product-list", "--json"], mock)

    expect(streams.stderr.join("\n")).toContain("nothing after it")
  })
})

/**
 * CLI-13. The client has supported an AbortSignal since Phase 1 and the CLI never passed one, so a
 * Ctrl+C killed the process mid-request and left `run.json` saying `"status": "running"`. The
 * signal now comes from the run itself, which is what lets a signal handler finalize it.
 */
describe("a run that is cancelled", () => {
  it("passes its abort signal down, so the client can turn it into a cancellation", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [] }))
    const seen: (AbortSignal | undefined)[] = []
    const config = emptyConfig()
    config.profiles.production = { restEndpoint: "https://rest.iad-01.braze.com", readOnly: false }
    saveConfig(configDir, config)

    await run(["campaigns", "list", "--json"], {
      env: { BRAZE_CONFIG_DIR: configDir, BRAZE_RUNS_DIR: runsDir, BRAZE_API_KEY: "k", BRAZE_PROFILE: "production" },
      keyring: memoryKeyring(),
      streams,
      isTty: false,
      fetch: (input, init) => {
        seen.push(init?.signal ?? undefined)
        return mock.fetch(input, init)
      },
    })

    expect(seen[0]).toBeInstanceOf(AbortSignal)
  })
})
