# Configuration

Three sources, and the first one that answers wins: **a command line flag**, then **an environment
variable**, then **the config file**. Everything has a working default, so a fresh install needs
only a profile.

`braze --help` prints the paths resolved for the machine it is running on.

## Where things live

| | macOS | Linux |
|---|---|---|
| `config.json` | `~/Library/Preferences/brazecli/` | `~/.config/brazecli/` |
| run artifacts | `~/Library/Application Support/brazecli/runs/` | `~/.local/share/brazecli/runs/` |
| the API key | Keychain | Secret Service |

Move either directory with `BRAZE_CONFIG_DIR` or `BRAZE_RUNS_DIR`. Moving the config directory
also moves the keyring namespace, so a temporary config directory does not touch your real keys.

## Environment variables

| | |
|---|---|
| `BRAZE_PROFILE` | which profile to use, when the command does not name one |
| `BRAZE_API_KEY` | the key, overriding the keyring entirely |
| `BRAZE_REST_ENDPOINT` | the cluster, overriding the profile's |
| `BRAZE_CONFIG_DIR` | where `config.json` and the keyring namespace live |
| `BRAZE_RUNS_DIR` | where run artifacts are written |
| `BRAZE_OUTPUT` | `auto`, `pretty`, `json` or `jsonl` |
| `BRAZE_LOG` | log level for the run's `events.jsonl`: `debug`, `info`, `warn`, `error` |
| `BRAZE_NO_UPDATE_CHECK` | any value: no daily "a newer version exists" line |
| `BRAZE_STATE_DIR` | where `update-check.json` is kept, and `runs/` unless `BRAZE_RUNS_DIR` is set |

`BRAZE_API_KEY` with `BRAZE_REST_ENDPOINT` is a complete profile: with both set, nothing has to be
configured on the machine at all. That is the CI shape.

## `config.json`

Written by `braze profile add`, and safe to edit by hand. Every field below is optional except
`version` and a profile's `restEndpoint`.

```json
{
  "version": 1,
  "credentialStorage": "auto",
  "output": { "format": "auto", "color": "auto" },
  "logging": { "level": "info" },
  "http": {
    "timeoutMs": 30000,
    "retries": 1,
    "retryBaseDelayMs": 250,
    "retryMaxDelayMs": 10000,
    "maxRetryAfterMs": 30000
  },
  "bulk": { "concurrency": 4 },
  "updateCheck": true,
  "profiles": {
    "production": {
      "restEndpoint": "https://rest.fra-01.braze.eu",
      "readOnly": true,
      "expectMaxMonthlyActives": 2000000
    }
  }
}
```

| Field | |
|---|---|
| `credentialStorage` | `auto` (keyring, then a file), `keyring` (fail rather than fall back), `file` |
| `output.format` | `auto` picks tables on a terminal and JSON when piped; `json`, `jsonl` and `pretty` force it |
| `output.color` | `auto`, `always`, `never` |
| `logging.level` | what reaches the run's `events.jsonl`; never changes what stdout prints |
| `http.*` | per-attempt timeout (default 30 000 ms), retries after the first (default 1), and the backoff between them (250 ms doubling to a 10 s ceiling) |
| `http.maxRetryAfterMs` | the longest `Retry-After` from Braze that will be waited out rather than refused (default 30 000 ms) |
| `bulk.concurrency` | requests in flight during a bulk run, 1–32 |
| `updateCheck` | `false` stops the daily "a newer version exists" line; `braze update` still works |
| `profiles.<name>.readOnly` | refuse every write for this profile |
| `profiles.<name>.expectMaxMonthlyActives` | the ceiling `braze profile verify` checks against |

There is no `defaultProfile` worth setting: leaving the profile out of a command is an error by
design ([authentication.md](authentication.md)).

## Output

```sh
braze staging campaigns list            # a table, because stdout is a terminal
braze staging campaigns list | jq .     # JSON, because it is not
braze staging campaigns list --json     # JSON, whatever stdout is
BRAZE_OUTPUT=jsonl braze staging campaigns list
```

`--json` and `--output json` are the same thing. `jsonl` prints one JSON value per line, which
suits a pipeline that reads row by row.

**In any machine mode, stdout carries data and nothing else** — no spinner, no tick, no warning.
Diagnostics and errors go to stderr. This is the contract scripts depend on, and it has a test.

## Requests and retries

```sh
braze staging campaigns list --timeout 5000 --retries 1
```

Reads are retried with exponential backoff, and a `429` is obeyed for as long as Braze asks, up to
`maxRetryAfterMs`. **Writes are never retried automatically** — Braze documents no general
idempotency key, so a retry could double-write. A write whose connection died after the request
left is reported as `outcome_unknown`, which is not a failure and must not be retried blindly.

## Bulk

`--concurrency` on the command line, `bulk.concurrency` in the file. See [bulk.md](bulk.md) for
what the number actually costs in memory.
