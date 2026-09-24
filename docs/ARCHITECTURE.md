# Architecture

How this repository is put together and, more usefully, which seams you are not allowed to cross.

`BrazeClient` performs one timed, cancellable attempt (`send`) under a policy layer that
classifies, retries reads and refuses to guess about writes (`execute`). The CLI adds profiles,
keyring storage, output modes and run artifacts on top.

The catalog is `spec/braze.postman.json`, a committed snapshot of Braze's own collection;
`packages/core/src/operations/generated.ts` holds the 95 operations generated from it, read through
`catalog` in `packages/core/src/operations/index.ts`. Every one of them is registered as a typed
command, and `braze api` remains the escape hatch for anything the catalog does not carry.

Source brief: [`REQUIREMENTS.md`](REQUIREMENTS.md) §2–§5, §18–§19, §61.

---

## 1. Two halves, one direction, one published package

```text
                       portable — no Node, no filesystem, no terminal
                 ┌──────────────────────────────────────────────┐
                 │  the Braze client       packages/core        │
                 │                                              │
                 │  BrazeClient · operations · Valibot schemas  │
                 │  retry · pagination · batching · bulk queue  │
                 │  error model · Logger interface              │
                 └───────────────────────┬──────────────────────┘
                                         │ adapters only
                 ┌───────────────────────▼──────────────────────┐
                 │  the command            packages/cli         │
                 │                                              │
                 │  Commander · keyring · config files · Pino   │
                 │  Clack · colors · tables · CSV · run dirs    │
                 └──────────────────────────────────────────────┘
```

`cli` depends on `core`. **`core` never depends on `cli`, and never learns that a CLI exists.**

What every command line tool needs comes from [`@leemour/cli-core`](https://www.npmjs.com/package/@leemour/cli-core),
shared with max-cli: output streams, the renderer, exit codes, the keyring, config loading and the
atomic write, paths, credentials, the Pino adapter for the run log, the command registry behind
`braze commands`, shell completion and self-update. `packages/cli` keeps only what is braze's: the
config schema, the `BRAZE_*` variables, the `brazecli` keyring service, `runs/`, `formulaSafe`,
and the one-time rewrite of a `credentials.json` from before cli-core. cli-core is Node, so none of
it may reach `packages/core`.

**One package reaches npm.** `@leemour/brazecli` is published; `packages/core` is private and is inlined
into `dist/bin/braze.js` at build time by [`scripts/bundle-cli.mjs`](../scripts/bundle-cli.mjs).
Nobody installing a command line tool has a reason to install its HTTP client separately
(`NEED-47`).

Why the two halves stay separate in the source anyway: the boundary is what keeps the client
honest. Everything the machine knows — the key, the paths, the terminal, the clock — enters core as
an argument, which is what makes retry, timeout and batching testable without waiting for anything,
and what leaves the door open to running the client somewhere without Node later (`OPS-5`, and it
would need core published first).

Because core is inlined, **its dependencies are the command's dependencies**: `p-queue` and
`valibot` are listed in `packages/cli/package.json`, and the bundler fails the build if the bundle
imports anything that is not.

## 2. What core may use

Web Platform only: `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`,
`AbortController`, `Blob`, `FormData`, `crypto.randomUUID()`, `performance.now()`, `setTimeout`,
`ReadableStream`.

Not in core: `node:*` of any kind, `Buffer`, `process`, `process.env`, Pino, Commander, Clack,
keyring, config files, anything that formats a terminal.

**Everything the environment knows is passed in.** Core does not read `process.env.BRAZE_API_KEY`;
the CLI reads it and hands it to `BrazeClient`. Core does not know where a config file lives, what
a TTY is, or which profile is selected.

## 3. The portability gate has three layers, and each catches what the others miss

| Layer | Where | Catches | Misses |
|---|---|---|---|
| Biome rules | `biome.json`, `overrides` for `packages/core/**` | `import "node:fs"`, bare `process`/`Buffer`/`window` **in our own source** | anything arriving through a dependency |
| `"types": []` | `packages/core/tsconfig.json` | `process` typechecking clean because `@types/node` leaked in through the workspace | runtime-only usage |
| neutral bundle | `scripts/check-core-portability.mjs` | a **dependency** importing a Node builtin — there is no source of ours to lint | nothing so far |

The bundle checks **every published entry of core**, `.` and `./testing`. The test kit is the file
most likely to reach for a timer or a Node builtin, and it ships to consumers like the rest.

Run them with `pnpm lint`, `pnpm typecheck`, `pnpm portability:core`. All three are proven against
a canary — `export const home = () => process.env.HOME` in `packages/core/src` turns each one red.

**Biome and `types: []` are the authority on globals; the bundle is the authority on imports.**
The bundle also scans for Node globals, but only in usage shapes (`process.`, `typeof process`,
`new Buffer`) rather than as bare words — a plain `/\bprocess\b/` matched the English sentence
"the queue will process records" inside a string literal and failed a clean bundle. A gate that
cries wolf gets switched off, so its calibration is tested in both directions:
`tests/core-portability.test.ts` asserts it fires on a real `process.env`, fires on a `node:`
import, and stays quiet on that sentence.

⚠ **`bun build --target=browser` is not a substitute for the neutral bundle.** It rewrites
`node:fs` to `{}` and exits 0 — green build, runtime failure. Bun's role here is different: it is
the **second runtime**, and `pnpm smoke:bun` actually executes core under it.

## 4. Dependency injection, kept small

`BrazeClient` takes its environment as plain functions:

```ts
new BrazeClient({ endpoint, apiKey, fetch, sleep, clock, now, random, logger })
```

Defaults are `globalThis.fetch`, a `setTimeout`-backed sleep, `performance.now`, `new Date`,
`Math.random` and `noopLogger`. That is the whole mechanism — no container, no decorator, no
registry. It exists so retry and timeout can be tested without waiting, and so a Worker can pass
its own fetch.

**Two clocks, deliberately not one.** `clock` is monotonic and every duration comes from it — a
wall clock can step backwards and make a duration negative. `now` is wall time, and every
timestamp a person or another system will read comes from it.

**`sleep(ms, signal)` is the only time primitive**, and it serves both the per-attempt timeout and
the retry backoff. A test passes a sleep that resolves at once to force a timeout, or one that
never settles to rule one out. Nothing in the test suite waits.

## 5. Logging is not rendering

Two separate concepts that must never merge:

- **Logger** — structured records for machines. JSON lines, persisted to a run's `events.jsonl`.
  No ANSI, no colour, no decoration. Core only knows the four-method `Logger` interface; the CLI
  adapts Pino to it through cli-core's `createFileLogger`.
- **Renderer** — the terminal surface for a person. Clack, colours, spinners, tables, emoji.

A spinner frame must never reach a log file, and a log record must never reach stdout in JSON
mode. [`TESTING.md`](TESTING.md) describes the test that holds this line.

## 6. Where the API catalog comes from

Braze has hundreds of endpoints. Neither hand-writing them nor fetching them at startup is
acceptable, so:

```text
official Braze collection → (explicit dev-time sync) → spec/braze.postman.json (committed)
  → generator → generated catalog + coverage report
  → + handwritten overrides → bundled operation manifest → dynamically registered commands
```

The committed snapshot is what ships. A change in Braze's API therefore arrives as a reviewable Git
diff rather than as a silent change in the installed CLI's behaviour.

**The source** is Braze's own Postman documenter,
`https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG`, which answers `200` with the
whole collection as JSON and needs no Postman account or token. 99 requests, every one carrying a
distinct Postman id, and three consecutive downloads are byte-identical — so `spec:sync` downloads
rather than validating a hand-made export (`NEED-13`).

⚠ That address is Postman's internal API rather than a published interface, so it may change
without notice (`RISK-2`). Nothing at runtime depends on it: the committed snapshot is what ships,
and a dead address breaks the developer's `spec:sync`, not an installed CLI. The requirement it
creates is that `spec:sync` verify it received a collection before overwriting `spec/`.

## 7. A 2xx is not proof every record landed

Braze answers `/users/track` with **201 and a populated `errors` array** when some records in the
batch failed. Nothing above the HTTP layer can recover that once it is thrown away, so
`ExecuteResult` carries `raw` — the body exactly as Braze sent it — alongside the parsed `data`.

This is why the audit CSV says `submitted` and not `success` for a record in a batch Braze
accepted: the request succeeded, and whether that particular user was updated is a different
question with a different answer.

**Braze does say which objects it refused, and its own documentation does not mention it.** Measured
against a staging workspace on 2026-09-15, five objects sent and three refused:

```json
{"attributes_processed": 2,
 "errors": [{"index": 1, "input_array": "attributes", "type": "'email_subscribe' must be …"}, …]}
```

`index` counts from zero **inside the named array**, not across the request, so a record's position
in its own field's array is what `packages/core/src/bulk/verdict.ts` records at dispatch. Neither
field appears on Braze's page, so every read of that shape degrades rather than throws: an entry we
cannot place makes `unknown` the records it might be, never `failed`. The response is kept verbatim
as a fixture in `verdict.test.ts`, because a measurement nobody can replay is a rumour.

## 7a. The bulk pipeline is a pull chain, and the bound is a number

`executeBulk` is an async generator: it advances the source only when the consumer asks for the next
outcome. That makes "the parser must not enqueue two million promises" (§39 of the brief) impossible
rather than merely unlikely, since nothing else can advance the source.

**At most `concurrency * 2` batches are outstanding at once** — queued, running, *and finished but
not yet yielded*, counted together. The third of those is the one that is easy to leave out and the
one that makes the bound true: without it, an endpoint answering faster than the consumer reads
empties the queue between pulls and the loop reads the whole file into memory (`BUG-9`). So at most
`concurrency * 2 * batchSize` records are resident — 600 at the defaults, **measured at 599** on a
million-record run.

The chain only holds if every link pulls: the CLI's audit writer awaits `drain` when the file cannot
keep up, which is what stops the whole pipeline running at Braze's speed.

**Where each half lives:** core batches, sends and decides each record's status, and knows nothing
about files; the CLI owns the JSONL and CSV parsers, `records.csv`, the progress line and the signal
handler. Core takes an async iterable and returns one, so the same executor runs over a database
cursor or a generator.

## 8. A message from Braze is untrusted data, not text

Braze answers a 401 with `Invalid API key: <the key itself>` in the body. The first real request
ever made from this repository printed a production key to a terminal, because the error handler
passed the provider's message through verbatim (`SEC-1`, 2026-09-13).

`BrazeClient` now redacts its own key out of every message it builds — it is the only component
that holds the secret, so it is the only one that can. **The wider rule: never place a
third-party string into output or a log without treating it as data that came from outside.**
When Phase 2 generates hundreds of operations, that rule has to hold in one place, and one place
is the client.

## 9. Trade-off order

When two of these conflict, the earlier one wins:

```text
correctness > safety > auditability > agent determinism > portability > debuggability
> human UX > implementation cleverness
```
