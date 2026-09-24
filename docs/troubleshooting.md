# Troubleshooting

The failures people actually hit, and what each one means. Every command prints its diagnostics on
stderr; in `--json` mode the error is one JSON object there, with an exit code to branch on.

## "no profile named …" or "a profile is required"

Exit code 3, `configuration_error`. There is no default profile on purpose. Name it as the first
word, or set `BRAZE_PROFILE`:

```sh
braze staging campaigns list
BRAZE_PROFILE=staging braze campaigns list
braze profile list                        # what exists
```

## `401 Invalid API key` — but the key is right

Almost always the wrong cluster. Braze answers `401` for a key it does not know, and a key from
another cluster is a key it does not know. `403 Access Denied` is the opposite signal: the key is
recognised and lacks a permission for that endpoint.

```sh
braze profile add staging --endpoint https://rest.fra-01.braze.eu    # the right one for you
```

Braze maps dashboard URLs to REST endpoints in
[the API overview](https://www.braze.com/docs/api/basics). European workspaces are on `braze.eu`.

## `403 Access Denied` on one command and not another

Braze scopes API keys per endpoint group. The key is valid and does not carry that permission —
`users.delete`, `campaigns.list` and so on are granted separately in the Braze dashboard.

## "the OS keyring is unavailable … storing in …/credentials.json instead"

Exactly what it says: the key was written to `credentials.json` in the config directory, with
permissions `0600`. It happens on a headless Linux box with no Secret Service running, in some
containers, and over SSH without an unlocked session keyring.

To keep it from happening silently on a machine where it matters, set `credentialStorage` to
`keyring` in `config.json` and the command fails instead of falling back. In CI, skip the keyring
entirely: `BRAZE_API_KEY` and `BRAZE_REST_ENDPOINT` in the environment override everything.

## `SyntaxError` right after installing

Node is too old. This needs Node 22 or newer:

```sh
node --version
```

Homebrew's `node` may be older than the one your version manager provides; `which -a node` shows
which one the shell picked.

## `braze: command not found` after a global install

The package manager's global bin directory is not on your PATH. `npm prefix -g` and `pnpm bin -g`
print where the command went; add that directory to your PATH, or use `npx @leemour/brazecli …` instead.

## `confirmation_required` (exit code 7)

The command is a write and `--confirm` was not given. Nothing was sent. Add `--confirm`, or
`--dry-run` to see what it would do.

## `permission_error` (exit code 5) on a write, with `--confirm` given

The profile is read-only. That is the point of it — it refuses writes before flags are considered.
Use another profile, or take the mark off deliberately:

```sh
braze profile add production --no-read-only
```

## `rate_limited` (exit code 8)

Braze's rate limit. The error carries `retryAfterMs`; reads retry on their own within
`maxRetryAfterMs`, and anything longer is refused rather than silently waited out. For a bulk run,
lower `--concurrency` — the limits are per workspace, not per process.

## `outcome_unknown` (exit code 14)

A write left and no answer came back. It may or may not have been applied, and **it must not be
retried blindly** — Braze documents no general idempotency key, so a retry can double-write. Read
the current state back, then decide.

In a bulk run these records are `unknown` in `records.csv`, and the row names the batch they were
in.

## A bulk run says `submitted` and Braze does not have the data

`submitted` means Braze accepted the request that carried the record, not that the user was
updated — Braze acknowledges a batch, never the users inside it. Check `records.csv` for `failed`
rows in the same run: Braze names refused objects inside an otherwise successful response, and
those rows carry the reason.

```sh
dir=$(braze runs path <run-id>)
awk -F, '$12=="failed" || $12=="invalid"' "$dir/records.csv" | head
```

## "cannot tell what format … is in"

The records file is not named `.jsonl`, `.ndjson` or `.csv`, or it came from standard input. Name
it: `--records-format jsonl`.

## A profile name is refused

Profile names may not collide with command names (`users`, `campaigns`, `api`, `runs`, `profile`,
`schema`, `skill`, …), because `braze users track` would otherwise mean two things.

## Nothing above matches

Every run leaves its evidence on disk:

```sh
braze runs list
braze runs show <run-id>
BRAZE_LOG=debug braze staging campaigns list      # a fuller log, same stdout
cat "$(braze runs path <run-id>)/events.jsonl" | jq .
```

That directory plus the exact command is what an issue at
[github.com/leemour/brazecli/issues](https://github.com/leemour/brazecli/issues) needs — read it
first, it describes your data ([security.md](security.md)).
