# Development

Working on brazecli itself. For using it, start at the [README](../README.md).

## Getting it running

```sh
pnpm install              # pnpm 11+, Node 22+ (24 in CI)
pnpm build
pnpm test
```

`pnpm install` also installs the git hooks through lefthook. The pre-commit hook runs Biome and a
secret scan; the pre-push hook runs the typecheck and the portability gate.

## The gates, and what each one is for

```sh
pnpm lint                 # Biome: formatting, lint, and the ban on Node APIs inside core
pnpm typecheck            # tsc --build across both packages
pnpm test                 # vitest
pnpm portability:core     # core bundles for a runtime with no builtins at all
pnpm smoke:bun            # core actually executes under bun
pnpm catalog:check        # the generated catalog still matches the committed spec
pnpm docs:check           # commands.md still matches the CLI  (run `pnpm build` first)
pnpm version:check        # the four places the version lives still agree
```

[CI](../.github/workflows/ci.yml) runs all of them on every pull request. Run `pnpm build` before
`pnpm test`: `tests/machine-output.test.ts` runs the built binary.

A single file: `pnpm vitest run packages/core/src/retry.test.ts`. Watch mode: `pnpm test:watch`.

## The constraint that shapes everything

`packages/core` must run unchanged in a Cloudflare Worker: no `node:*`, no `process`, no `Buffer`,
no config file, no terminal formatting. Everything the environment knows is **passed in as an
argument**.

Three gates enforce it and they exist because any one alone lets something through — the Biome
rules catch our own source, `"types": []` catches `@types/node` leaking in through the workspace,
and the neutral bundle catches a *dependency* importing a builtin, where there is no source to
lint. [ARCHITECTURE.md](ARCHITECTURE.md) §3 has the table of what each one misses.

⚠ `bun build --target=browser` is **not** a substitute for the neutral bundle: it rewrites
`node:fs` to `{}` and exits 0. Bun's role is different — it is the second *runtime*.

## Generated files, which are never edited by hand

| File | Written by |
|---|---|
| `packages/core/src/operations/generated.ts` | `pnpm catalog:generate` |
| `docs/catalog-coverage.md` | `pnpm catalog:generate` |
| `docs/commands.md` | `pnpm docs:generate` |
| `spec/braze.postman.json` | `pnpm spec:sync` — downloads from Braze, run deliberately |

Editing one by hand fails CI on the next push. Correct the generator, or the overrides in
`packages/core/src/operations/overrides.ts`, and regenerate.

## Making a change

Work on a branch off `main` and open a pull request; CI gates every one. Conventional commits.

**Write a plan first** for anything that is not a one-file, one-step change — orient, write the
plan, stop for review, then build against it. The rules are in [CLAUDE.md](../CLAUDE.md). A typo or
an obvious one-line bug just gets fixed.

**Take a backlog number rather than inventing one.** Numbers are permanent addresses that commits
and code comments cite, and they are never reused:

```sh
git pull --ff-only
grep -ohE 'CLI-[0-9]+' docs/BACKLOG.md docs/BACKLOG_DONE.md | sort -V | tail -1
```

**A document claiming something is broken or unfinished is a snapshot of someone else's day.**
Check it before acting on it — `git log -S'<string that should not be there>' -- <path>` — and
correct the document that is wrong, in place.

## Where each fact lives

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | how it is built now, and which seams not to cross |
| [CONVENTIONS.md](CONVENTIONS.md) | how code and documents are written here |
| [TESTING.md](TESTING.md) | what runs where, and how to check it yourself |
| [DECISIONS.md](DECISIONS.md) | what was ruled and why — read before "fixing" something odd |
| [BACKLOG.md](BACKLOG.md) | what is left to build |
| [REQUIREMENTS.md](REQUIREMENTS.md) | the brief this was built against |
| [releasing.md](releasing.md) | how a version is published, and by whom |

Two copies of a fact drift, and the reader cannot tell which is current. Link, do not restate.

## Checking a key against live Braze

```sh
./scripts/check-key.sh staging
```

It sends the same read through the CLI and through bare `curl`. **Identical answers mean the key
or the cluster is wrong; differing answers mean we are.** Neither output can print the key: Braze
returns it inside the body of a 401.

⚠ **Never send a non-GET request to a production workspace without asking the owner first** — not
even one the catalog classifies as a read. That classification is the thing that might be wrong.
`--dry-run` needs no permission and works on a read-only profile.
