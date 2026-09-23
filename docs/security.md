# Security

What this tool does with your Braze key, what it writes to disk, and what it refuses to do.

## The API key

- **It is never a command line argument.** There is no flag for it: an argument is visible in
  `ps`, in your shell history and in any process listing. `profile add` reads it without echoing,
  or takes it on standard input with `--key-stdin`.
- **It is stored in the OS keyring** — Keychain, Secret Service, Credential Manager — not in
  `config.json`. When the keyring is unavailable, it goes to `credentials.json` in the config
  directory with permissions `0600`, and a warning says so on stderr the first time. That fallback
  never happens silently.
- **It never reaches a log.** Not redacted in a log — absent from it. Redaction is the second line
  of defence here, not the first.
- **Braze returns your key inside the body of a `401`.** That is Braze's behaviour, not ours, and
  it means an error body is not safe to print as it arrives. The client redacts it before anything
  else sees it, and anything else in this repository that talks to Braze has to do the same.
- `braze profile list` prints names, endpoints and whether a key exists — never the key.

## Text that came from somewhere else

A campaign name, a catalog title, a user attribute and every error message Braze returns are edited
outside this tool and handed back as data. A terminal executes what it is given — `\x1b[2K\x1b[1G`
clears the line and returns the cursor, so a campaign name can overwrite output this tool already
printed.

- **Control characters are made visible, not removed**, wherever a person reads them: tables,
  field lists, diagnostics on stderr and every column of `records.csv`. They appear as `\x1b`, so
  you can see the value contained something strange rather than having it silently dropped.
- **Machine output is untouched.** `--json` and `--jsonl` already escape control characters through
  `JSON.stringify`, and those bytes are a contract with whatever parses them.
- **`records.csv` marks free text as literal.** Excel and LibreOffice execute a cell that begins
  `=`, `+`, `-` or `@` **even when the CSV quotes it**, so `error_message` and `note` get a leading
  apostrophe when they start that way.

⚠ **Identifier columns are deliberately left byte-exact** — `record_id`, `external_id`, `braze_id`
and the alias columns. A prefixed identifier no longer joins back to the file it came from, and
joining back is the only reason those columns exist. So an identifier taken from **your own input
file** can still be a formula when you open the audit in a spreadsheet. If the file came from
somewhere you do not control, import it as text rather than double-clicking it.

## Guards against the wrong workspace

Three, and they fail in this order:

1. **A read-only profile** refuses every write before flags are considered. Recommended for
   anything pointing at production.
2. **`--confirm`** is required on every write, as a flag and never as a prompt. A command missing
   it stops with `confirmation_required` and sends nothing.
3. **`--dry-run`** validates and counts without sending, and works on a read-only profile.

There is no default profile: a command that does not name one is an error, never a guess.

`braze profile verify` is the check for "is this key still pointing where I think?" — Braze exposes
no workspace identifier, so it compares the workspace's monthly active users against a ceiling you
recorded. See [authentication.md](authentication.md).

## What lands on disk

Every invocation that touches Braze writes a directory under the runs path:

| | |
|---|---|
| `run.json` | what was asked, what happened, the profile name, the operation, timings |
| `events.jsonl` | the structured log for that run |
| `records.csv` | one row per record, when more than one was touched |

All of it is written `0600`. **None of it contains the API key.** It does contain the shape of your
data: identifiers, counts, campaign names, error messages from Braze. Treat a run directory as
customer data — it is the right thing to attach to a bug report only after you have read it.

The audit deliberately keeps identifiers and nothing else: no custom attribute, no arbitrary column
from your input, because a column there is customer data kept forever.

Nothing is ever sent anywhere but Braze. There is no telemetry.

## Writes are never retried on their own

Braze documents no general idempotency key, so a retried write can apply twice. Reads back off and
retry; writes do not. A write whose connection died after the request left is reported as
`outcome_unknown` — not a failure, not a success, and not something to retry blindly.

## In CI

Put the key in the CI secret store and pass it as `BRAZE_API_KEY`, with `BRAZE_REST_ENDPOINT`
beside it. Nothing then needs a keyring, a config file or a profile. Use a key with only the
permissions the job needs — Braze scopes keys per endpoint group — and prefer a read-only job where
the work allows it.

## Reporting something

Security issues: open an issue at
[github.com/leemour/brazecli/issues](https://github.com/leemour/brazecli/issues) without the
details, and say how to reach you privately. Do not paste a key, a run directory or a Braze
response into a public issue.
