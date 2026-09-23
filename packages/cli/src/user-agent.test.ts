import { describe, expect, it } from "vitest"
import { userAgent } from "./user-agent.js"
import { VERSION } from "./version.js"

const versions = (over: Partial<NodeJS.ProcessVersions>): NodeJS.ProcessVersions =>
  ({ node: "24.19.0", ...over }) as NodeJS.ProcessVersions

describe("userAgent", () => {
  it("names the package version Braze will see", () => {
    expect(userAgent(versions({}), "linux")).toBe(`brazecli/${VERSION} runtime/node platform/linux`)
  })

  // Measured under bun 1.3.14: it reports process.versions.node as 24.3.0, so a node-first check
  // would label every bun run as node.
  it("reports bun as bun, although bun also claims a node version", () => {
    expect(userAgent(versions({ bun: "1.3.14", node: "24.3.0" }), "darwin")).toBe(
      `brazecli/${VERSION} runtime/bun platform/darwin`,
    )
  })

  it("reports deno as deno", () => {
    expect(userAgent(versions({ deno: "2.5.0" }), "linux")).toContain("runtime/deno")
  })

  it("reads the real process when given nothing", () => {
    expect(userAgent()).toMatch(/^brazecli\/\d+\.\d+\.\d+ runtime\/(node|bun|deno) platform\/\w+$/)
  })

  // The header names the runtime and stops there: a patch version is a fact about the machine,
  // and `api.test.ts` holds the same line from the other end.
  it("discloses no version of the runtime it is on", () => {
    expect(userAgent(versions({ bun: "1.3.14", node: "24.3.0" }), "linux")).not.toContain("1.3.14")
    expect(userAgent(versions({}), "linux")).not.toContain("24.19.0")
  })
})
