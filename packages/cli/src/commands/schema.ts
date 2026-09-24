import type { Streams } from "@leemour/cli-core"
import { BrazeError, catalog, findByCommand, findOperation, type Operation } from "brazecli-core"
import { Command } from "commander"
import { outputFor } from "../output/context.js"

export interface SchemaContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

/**
 * The contract of one operation. `braze commands --json` says what commands exist; this says what
 * a single one needs in order to be called.
 *
 * **It talks to Braze not at all**, so like `profile`, `runs` and `commands` it needs no profile
 * (`NEED-25`). Asking for a credential in order to describe a command would make the discovery
 * surface depend on local configuration, which is the thing `commands --json` is careful to avoid.
 */
export const schemaCommand = (context: SchemaContext = {}): Command => {
  const command = new Command("schema")
    .description("everything needed to call one operation: parameters, body, and whether it writes")
    .argument("<operation...>", "an operation id (campaigns.list.get) or the command words (campaigns list)")

  command.action(function (this: Command, words: string[]) {
    const { renderer } = outputFor(this, context)

    renderer.result(describe(resolve(words)))
  })

  return command
}

/**
 * Either spelling, because the two discovery surfaces speak different languages: an agent reading
 * `braze commands --json` holds command words, while `docs/catalog-coverage.md` and `overrides.ts`
 * are keyed by id. One extra lookup removes a whole class of "I have the wrong kind of name".
 */
const resolve = (words: readonly string[]): Operation => {
  const joined = words.join(" ")
  const found = (words.length === 1 ? findOperation(words[0] as string) : undefined) ?? findByCommand(words)
  if (found) return found

  throw new BrazeError("validation_error", `no operation "${joined}". ${suggest(joined)}`)
}

/**
 * A near miss is the common case, and the commonest of all is the singular: Braze's own brief
 * writes `braze campaign list` for what `NEED-18` settled as `campaigns list`. So words are
 * matched by prefix in either direction — `campaign` finds `campaigns`, and `camp` finds it too.
 *
 * Scored rather than filtered, because a query that matches one word of forty operations should
 * offer the ones that match two.
 */
const suggest = (query: string): string => {
  const tokens = query.split(/[\s.]+/).filter(Boolean)

  const near = catalog
    .map((operation) => ({ operation, score: score(tokens, operation) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((scored) => scored.operation.command.join(" "))

  return near.length > 0
    ? `Did you mean: ${near.join(", ")}?`
    : "Run `braze commands --json` for the whole surface, or `braze --help`."
}

const score = (tokens: readonly string[], operation: Operation): number => {
  const words = [...operation.command, ...operation.id.split(".")]
  return tokens.filter((token) => words.some((word) => word.startsWith(token) || token.startsWith(word))).length
}

const CHECKS: Record<string, string> = {
  strict: "a handwritten schema checks the body's fields before anything is sent",
  generated:
    "the body is checked only for being the same JSON kind as Braze's example — an example is not a schema, so unknown fields pass",
  passthrough: "the body is not inspected at all; Braze documents it as prose rather than JSON",
}

const describe = (operation: Operation) => ({
  id: operation.id,
  command: operation.command,
  usage: usageOf(operation),
  method: operation.method,
  path: operation.path,
  access: operation.access,
  retryPolicy: operation.retryPolicy,
  // Computed, never stored: `assertWriteAllowed` already derives it, and two sources of truth for
  // "may this be sent" is how one of them ends up wrong. Printed because an agent otherwise learns
  // it only by getting `confirmation_required` back.
  confirmationRequired: operation.access === "write",
  ...(operation.permission ? { permission: operation.permission } : {}),
  ...(operation.pagination ? { pagination: operation.pagination } : {}),
  ...(operation.pageSize === undefined ? {} : { pageSize: operation.pageSize }),
  ...(operation.batch ? { batch: operation.batch } : {}),
  // The binding limit, and it must travel with `batch` rather than beside it: Braze caps
  // /users/track at 75 objects across the three arrays TOGETHER, so an agent reading 75/75/75 and
  // batching by it sends three times the allowance (BUG-8).
  ...(operation.batchTotal === undefined ? {} : { batchTotal: operation.batchTotal }),
  pathParameters: operation.pathParameters ?? [],
  queryParameters: operation.queryParameters ?? [],
  requestBody: bodyOf(operation),
  // What will and will not be checked before the request leaves. An agent that knows its body is
  // only kind-checked knows not to read a silent acceptance as approval of its fields.
  validation: {
    level: operation.validation ?? "generated",
    checks: CHECKS[operation.validation ?? "generated"],
  },
  ...(operation.description ? { description: operation.description } : {}),
})

/**
 * Says where the body text came from, because the two are not interchangeable and an agent that
 * treats Braze's prose as a payload will send nonsense. `example` can be sent as-is; `annotated`
 * is documentation Braze wrote in the value position and parses as nothing (`FIND-17`).
 */
const bodyOf = (operation: Operation) => {
  if (!operation.requestBody) {
    return operation.access === "write" || operation.method !== "GET"
      ? { source: "none", note: "Braze documents no body for this endpoint. Pass one with --input if you have one." }
      : { source: "none", note: "This operation takes no request body." }
  }

  return operation.requestBody.source === "example"
    ? {
        source: "example",
        example: operation.requestBody.example,
        note: "A real example from Braze's collection. It is an example, not a schema — other fields may be valid.",
      }
    : {
        source: "annotated",
        text: operation.requestBody.text,
        note: "Braze documents this body as annotated prose, not JSON. Read it; do not send it.",
      }
}

const usageOf = (operation: Operation): string =>
  [
    "braze",
    "<profile>",
    ...operation.command,
    ...(operation.pathParameters ?? []).map((name) => `--${name.replace(/_/g, "-")} <value>`),
    operation.access === "write" ? "--confirm" : "",
    "--json",
  ]
    .filter(Boolean)
    .join(" ")
