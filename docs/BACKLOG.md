# Backlog

What is left to build, one line each. A closed item is **deleted** from here and gets a line in
[`BACKLOG_DONE.md`](BACKLOG_DONE.md).

The brief: [`REQUIREMENTS.md`](REQUIREMENTS.md). How it is built: [`ARCHITECTURE.md`](ARCHITECTURE.md).
What was ruled and why: [`DECISIONS.md`](DECISIONS.md).

<details>
<summary>Rules of this file — read once</summary>

- **A number is a permanent address**, never reused. Take the next one with:
  ```sh
  git pull --ff-only
  grep -ohE '<PREFIX>-[0-9]+' docs/BACKLOG.md docs/BACKLOG_DONE.md | sort -V | tail -1
  ```
- **Prefixes, and nothing invented:** `OPS` repository, tooling, CI, release · `CORE`
  `packages/core` · `CLI` `packages/cli` · `CAT` spec, catalog, generated docs · `BULK` the bulk
  pipeline and its artifacts · `DOC` handwritten documentation. `SEC-2` predates this list and
  keeps its number.
- **The title is the task, not the symptom.** "Give ambiguous writes their own outcome", not
  "ambiguous writes look like failures".
- **One line, with a `path:line` in it.** Analysis goes elsewhere: a durable truth about an area to
  [`ARCHITECTURE.md`](ARCHITECTURE.md), an owner's ruling to [`DECISIONS.md`](DECISIONS.md), a
  plan to `docs_ai/plans/` (local only).
- **Priority.** **P1** breaks something real or blocks other work · **P2** needed this cycle ·
  **P3** someday.
- **Mark.** Empty — not started · 🟡 half done, the remainder named in the line · ⏸️ deferred by
  the owner · 🚩 waiting on an owner decision.
- **Check the line before acting on it:** `git log -S'<string>' -- <path>`.

</details>

---

## Status

Published: [`@leemour/brazecli`](https://www.npmjs.com/package/@leemour/brazecli) `0.1.1`. 554
tests. Unreleased on `main`: `SEC-2`. Phases 1–3 are closed — see [`BACKLOG_DONE.md`](BACKLOG_DONE.md).

Nothing is blocked on the owner.

## Worth doing next

| Number | Task | P |
|---|---|---|
| `OPS-4` | `test:live` harness — read-only by default, its own profile, never in CI. Every live check so far has been a one-off shell command that nobody can re-run | P2 |
| `CAT-10` | Build a request from every operation that documents a body — 48 body examples in the collection, 32 of them placeholder-free JSON. Not response assertions: the collection carries zero response examples (`NEED-28`) | P3 |

## Quick wins

Each is one file and needs no decision.

| Number | Task | P |
|---|---|---|
| `CORE-11` | 🟡 One helper for the user agent instead of the same string in `packages/cli/src/execute.ts:170` and `commands/verify.ts:47`, with the runtime read from `process.versions` — both hardcode `runtime/node` while `pnpm smoke:bun` makes bun a supported runtime | P3 |
| `DOC-3` | `docs/development.md` — working on brazecli itself, split out of the README once there is a second contributor | P3 |
| `BULK-10` | `braze runs cleanup` with an explicit retention setting, opt-in and never a default (`NEED-3`) | P3 |

## Larger, when real usage asks for it

| Number | Task | P |
|---|---|---|
| `OPS-3` | Shell completions for bash, zsh and fish, generated from the catalog | P3 |
| `CORE-14` | MCP tool definitions generated from the same catalog as the commands and the docs | P3 |
| `BULK-11` | `braze run resume <run-id>` — `records.csv` already answers submitted / failed / unknown / not started per source record, so the data exists | P3 |
| `CAT-12` | Scheduled drift check against the live Braze collection, opening a pull request rather than changing behaviour silently | P3 |
| `CORE-13` | Adaptive rate limiting driven by observed headers rather than fixed concurrency | P3 |
| `OPS-5` | A Cloudflare Worker consumer package, which is also the strongest portability test. Needs `packages/core` published first, which `NEED-47` left open | P3 |

## Deferred

| Number | Task | P |
|---|---|---|
| `BULK-13` | ⏸️ Bulk input as one big JSON array. Streaming it means owning a hand-rolled incremental scanner; JSONL and CSV cover every stated use. Build it when somebody has an array they cannot convert | P3 |
| `OPS-6` | ⏸️ Publish from CI. Ruled out for now (`NEED-49`) — it would need a long-lived npm token to save one command a few times a year. Check npm's trusted publishing over OIDC first; it stores no token | P3 |
