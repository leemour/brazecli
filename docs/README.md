# Documentation

Start at the [README](../README.md) for what this is and the first command. These pages each answer
one question, and are opened for a task rather than read in order.

## Using it

| | |
|---|---|
| [installation.md](installation.md) | installing, updating, what needs which Node, where files land |
| [authentication.md](authentication.md) | profiles, the endpoint, the keyring, CI without one |
| [configuration.md](configuration.md) | every setting, every environment variable, what wins |
| [usage.md](usage.md) | the command surface, in the order you meet it |
| [bulk.md](bulk.md) | a file of records: batching, the audit, interruption, memory |
| [agents.md](agents.md) | the agent skill, and driving this from a script |
| [security.md](security.md) | where the key lives, what is written, what never is |
| [troubleshooting.md](troubleshooting.md) | the failures people actually hit |
| [releasing.md](releasing.md) | how a new version is published, and by whom |

## Reference

| | |
|---|---|
| [commands.md](commands.md) | every command and option — **generated**, `pnpm docs:generate` |
| [catalog-coverage.md](catalog-coverage.md) | how much of Braze is covered — **generated**, `pnpm catalog:generate` |

Neither generated file is ever edited by hand: `pnpm docs:check` and `pnpm catalog:check` fail CI
when one drifts from the thing it describes.

## Building it

| | |
|---|---|
| [development.md](development.md) | working on brazecli itself: the gates, the generated files, making a change |
| [ARCHITECTURE.md](ARCHITECTURE.md) | the two packages, the portability gates, where the catalog comes from |
| [CONVENTIONS.md](CONVENTIONS.md) | how code and documents are written here |
| [TESTING.md](TESTING.md) | how to check it yourself |
| [REQUIREMENTS.md](REQUIREMENTS.md) | the brief this was built against |
| [DECISIONS.md](DECISIONS.md) | what was ruled, and why — read before "fixing" something odd |
| [BACKLOG.md](BACKLOG.md) · [BACKLOG_DONE.md](BACKLOG_DONE.md) | what is left, and where a closed number went |

`ARCHITECTURE.md` describes how the code behaves **now**. When a document disagrees with the code,
the code is right and the document gets corrected in place.

The working trail — the handoff for whoever picks this up next, plans, the session journal and the
cleanup list — lives in `docs_ai/` on the machine doing the work and is deliberately not committed.
