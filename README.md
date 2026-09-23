# brazecli

Read from and write to the [Braze](https://www.braze.com/docs/api/basics/) REST API from a terminal
or a script — campaigns, canvases, users, catalogs, segments, exports — without writing a single
`curl` line.

It is built for **AI agents and automation first**: every command describes itself, every result is
available as one deterministic JSON value, and every failure has a code to branch on. That same
discipline is what makes it pleasant for a person — nothing is hidden, nothing is guessed, and the
terminal gets tables and colour rather than a wall of JSON.

```sh
npx @leemour/brazecli profile add staging --endpoint https://rest.fra-01.braze.eu
npx @leemour/brazecli staging campaigns list
```

## What you get

- **Shorter than curl.** `braze staging campaigns list` instead of a URL, an auth header and a
  query string assembled by hand every time. 95 typed commands, generated from Braze's own
  collection; anything the catalog does not carry is `braze api POST /some/path --input @body.json`.
- **Credentials out of reach.** The API key goes to your OS keyring: never a config file, never a
  command line argument, never your shell history, never a log.
- **Writes that cannot happen by accident.** `--confirm` on every write, `--dry-run` that validates
  and counts without sending, and profiles you can mark read-only so a production workspace refuses
  writes before a flag is even read.
- **The workspace is always named.** `braze production campaigns list` says which one it touched,
  in the command itself and in the audit afterwards. There is no default profile, so nothing lands
  in production because a flag was forgotten.
- **Bulk work that finishes.** Stream a JSONL or CSV file of hundreds of thousands of records,
  batched to Braze's limits, with bounded memory and one honest audit row per record.
- **One tool, two audiences.** A terminal gets tables, colour and a progress line; `--json` gets
  exactly one JSON value on stdout and a closed list of error codes on stderr.
- **Every run recorded.** One directory per invocation: structured logs, what was sent, what came
  back, and a per-record CSV when more than one record was touched.
- **Retries that do not lie.** Reads back off and retry; writes never retry on their own, because
  Braze documents no general idempotency key. A request whose connection died after it was sent is
  reported as `outcome_unknown`, not as a failure.

## Contents

- [Install](#install)
- [Authentication](#authentication)
- [Usage](#usage)
  - [Typed commands](#typed-commands)
  - [Any request at all](#any-request-at-all)
  - [Writes](#writes)
  - [Paging](#paging)
  - [Bulk: a file of records](#bulk-a-file-of-records)
  - [What a past run did](#what-a-past-run-did)
  - [Output for machines](#output-for-machines)
- [For AI agents](#for-ai-agents)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

## Install

The package is **`@leemour/brazecli`**; the command it installs is **`braze`**. (The unscoped name was
refused by npm as too close to an unrelated `braze-cli` — see
[docs/DECISIONS.md](docs/DECISIONS.md), `NEED-48`.)

**Run it without installing anything:**

```sh
npx @leemour/brazecli --help          # npm
pnpm dlx @leemour/brazecli --help     # pnpm
bunx @leemour/brazecli --help         # bun
```

**Keep it on your PATH:**

```sh
npm install -g @leemour/brazecli
pnpm add -g @leemour/brazecli
bun add -g @leemour/brazecli
```

**Or as a project dependency**, so everyone on the repository gets the same version:

```sh
pnpm add -D @leemour/brazecli         # then: pnpm exec braze --help
```

Needs **Node 22 or newer**. Developed on Linux and used on macOS; the keyring binary ships
prebuilt for both, so nothing is compiled at install time. Windows has a prebuilt binary too but
has not been exercised — [say so in an issue](https://github.com/leemour/brazecli/issues) if you
try it.

Full detail, including what to do when a global install is not an option:
[docs/installation.md](docs/installation.md).

## Authentication

Create the key in the Braze dashboard under **Settings → APIs and Identifiers → Create API Key**,
granting only the permissions you will actually use
([Braze's instructions](https://www.braze.com/docs/api/basics/)). The same page lists the REST
endpoint for every dashboard URL.

One profile per Braze workspace. A profile holds the REST endpoint and whether writes are allowed;
the API key goes to your OS keyring under that profile's name.

```sh
braze profile add production --endpoint https://rest.fra-01.braze.eu --read-only
braze profile add staging    --endpoint https://rest.fra-01.braze.eu
braze profile list           # names, endpoints, whether a key exists — never the key itself
```

`profile add` asks for the key and reads it without echoing. In CI, pipe it in instead:

```sh
echo "$BRAZE_KEY" | braze profile add ci --endpoint https://rest.fra-01.braze.eu --key-stdin
```

Check it landed:

```sh
braze profile verify production
```

That prints the endpoint, whether the profile is read-only, and the workspace's monthly active
users. If that number is not the size you expect, the key belongs to a different workspace.

Three things worth knowing before the first command:

- **The endpoint is your cluster, and it differs per customer.** Braze lists them against dashboard
  URLs in [the API overview](https://www.braze.com/docs/api/basics). European workspaces are on
  `braze.eu`, not `braze.com`; getting it wrong makes every command fail at once.
- **A workspace is chosen by its API key, not by the endpoint.** Two profiles on the same cluster
  URL can point at completely different data.
- **There is no default profile, on purpose.** A default is selected by omission, and the thing
  most easily omitted should not be the workspace with a million people in it.

```sh
braze staging campaigns list            # the profile comes first
braze --profile staging campaigns list  # the flag works too
BRAZE_PROFILE=staging braze campaigns list
```

`BRAZE_API_KEY` and `BRAZE_REST_ENDPOINT` override the stored profile entirely, which is how this
runs in a CI job with no keyring at all.

More: [docs/authentication.md](docs/authentication.md) · [docs/configuration.md](docs/configuration.md)

## Usage

### Typed commands

```sh
braze staging campaigns list
braze staging campaigns list --page 0 --include-archived false
braze staging catalogs items list --catalog-name my-catalog
braze staging users export ids --input @ids.json
```

Every Braze endpoint in the catalog is a command, with its path placeholders as required options
and its documented query keys as optional ones. `--query key=value` works on all of them, because
Braze's documented keys are never the whole list.

`braze commands` lists the surface; `braze schema campaigns list` prints one operation's contract —
parameters, body, and whether it writes. Every command is also in
[docs/commands.md](docs/commands.md), generated from the program itself.

### Any request at all

```sh
braze staging api GET /campaigns/list --query page=0
braze staging api POST /users/track --input @users.json --confirm
```

`braze api` sends anything Braze accepts, catalogued or not. It reads the body from a file
(`@file`), from standard input (`-`) or inline.

### Writes

Every write needs `--confirm`, and it is a flag rather than a prompt, so nothing ever blocks
waiting for a keypress:

```sh
braze staging users track --input @users.json --dry-run   # validates and counts, sends nothing
braze staging users track --input @users.json --confirm   # sends
```

A profile added with `--read-only` refuses writes before `--confirm` is even considered. `--confirm`
guards against a mistyped command; read-only guards against a correct command aimed at the wrong
workspace. Recommended for anything pointing at production.

### Paging

```sh
braze staging campaigns list --paginate --max-pages 20 --max-items 5000
```

`--paginate` walks a paged read and returns the pages as one value, under a ceiling it cannot
exceed. Without it, a full page tells you on stderr that there is probably more.

### Bulk: a file of records

```sh
braze staging users track --records users.jsonl --records-field attributes \
  --record-id external_id --confirm
```

Records stream out of a JSONL or CSV file, batch to Braze's limit of 75 per request, and go out
with four requests in flight by default. Memory stays bounded whatever the file size: a
million-record run holds around 600 records at a time.

Each record leaves a row in the run's `records.csv` with a truthful status — including the records
refused locally before sending, the ones Braze named inside an otherwise successful response, and
the ones an interrupted run never sent. Ctrl+C stops the run and still writes the audit.

More: [docs/bulk.md](docs/bulk.md).

### What a past run did

```sh
braze runs list                 # newest first
braze runs show <run-id>        # everything recorded about one invocation
braze runs path <run-id>        # the directory, for grep, jq or an upload
```

Every invocation that touches Braze writes `run.json`, `events.jsonl` and — when more than one
record was involved — `records.csv`. Set `BRAZE_LOG=debug` for a fuller log without changing what
stdout prints.

### Output for machines

```sh
braze staging campaigns list --json
```

`--json` puts exactly one JSON value on stdout and nothing else: no spinner, no `✓`, no warning.
A failure is one JSON object on **stderr**, with stdout left empty, so a refusal can never be
mistaken for a result:

```json
{"error":{"code":"rate_limited","message":"…","retryable":true,"retryAfterMs":3000}}
```

The exit code is the thing to branch on — `2` validation, `4` authentication, `5` permission,
`6` not found, `7` confirmation required, `8` rate limited, `9` timeout, `10` network,
`14` outcome unknown, `130` cancelled. `braze commands --json` publishes the whole table.

## For AI agents

Install the skill once, and Claude Code, Codex or Hermes knows how to drive this without being told
again:

```sh
npx @leemour/brazecli skill install
```

It writes `SKILL.md` into every agent it finds on the machine — `~/.claude/skills/braze/`,
`~/.codex/skills/braze/`, `~/.hermes/skills/braze/` — and prints what it did. Use `--claude`,
`--codex`, `--hermes` or `--project` to be explicit, and `--dir <path>` for anything else.

The skill teaches the two things an agent cannot guess: that discovery is `braze commands --json`
rather than remembered flags, and which failures must never be retried. What it says, and how to
drive this from a script without the skill: [docs/agents.md](docs/agents.md).

Unlike an MCP server, this needs no server process and no agent runtime, and nothing sits in the
context window until a command is actually run. It works the same from a shell, a CI job or an
agent.

## Documentation

| | |
|---|---|
| [docs/installation.md](docs/installation.md) | installing, updating, and what needs which Node |
| [docs/authentication.md](docs/authentication.md) | profiles, the keyring, CI without a keyring |
| [docs/configuration.md](docs/configuration.md) | every setting, where files live, precedence |
| [docs/usage.md](docs/usage.md) | the command surface, in the order you meet it |
| [docs/bulk.md](docs/bulk.md) | large files: batching, the audit, interruption |
| [docs/agents.md](docs/agents.md) | driving it from an agent or a script |
| [docs/security.md](docs/security.md) | where the key lives, what is logged, what is not |
| [docs/troubleshooting.md](docs/troubleshooting.md) | the errors people actually hit |
| [docs/commands.md](docs/commands.md) | every command and option — generated from the CLI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how it is built, and why core has no Node in it |

## Development

```sh
pnpm install
pnpm build
pnpm lint && pnpm typecheck && pnpm test
pnpm portability:core     # core bundles for a runtime with no builtins at all
pnpm smoke:bun            # core actually executes under a second runtime
```

Inside the repository the Braze client is kept apart from everything Node-shaped — `packages/core`
uses Web Platform APIs only, and three checks keep it that way. It is **not a separate install**:
the build inlines it into the one published package.

[docs/development.md](docs/development.md) covers the rest — every gate and what it catches, the
generated files that must not be edited by hand, and how a change gets made. The roadmap is
[docs/BACKLOG.md](docs/BACKLOG.md).

## License

MIT — see [LICENSE](LICENSE).
