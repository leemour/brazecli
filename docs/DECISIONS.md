# Decisions

Rulings by the owner, lifted out of the session journals. A journal is a trail of one day and is
short-lived; a decision holds until it is overturned, so it lives here.

**The `NEED-nn` number is the same one that appeared in the journal and in the reply footer.**
Plans, commits and other docs cite it. Numbers are never reused.

**How to use this file.** Found behaviour in the code or a document that looks wrong? Look here
before fixing it. A document that contradicts a line here is the thing that is wrong, not the
decision.

**An overturned decision is struck through, not deleted**, with a note saying what replaced it.

---

## 2026-09-13

**NEED-0 · Is the repository public?**
**Public.** Measured, not decided: `gh repo view` reports `"visibility": "PUBLIC"`. (The
repository was `leemour/braze-cli` when this was measured and is now
[`leemour/brazecli`](https://github.com/leemour/brazecli).) This settles remaining question #1 in
[`REQUIREMENTS.md`](REQUIREMENTS.md) and has two consequences that are already acted on: committed
documents are written in English, and CI runs on every pull request because Actions minutes are
free on a public repository.

**NEED-1 · What does a terminal get by default — a table or raw JSON?**
**A table (option A).** «1 - A». A TTY gets the pretty renderer; a pipe gets JSON; `--json` and
`BRAZE_OUTPUT=json` force JSON in either case. The strict half is unchanged and is what the tests
hold: in a machine mode **stdout carries data and nothing else**, diagnostics go to stderr.
Consequence for `CLI-5`: mode selection is one function, so the whole default can be inverted in
one line if agent traffic ever makes that the better default.

**NEED-2 · Publish to npm, and under what name?**
**As `@leemour/brazecli`, at `0.1.0`.** Both halves of the original ruling were overturned on
2026-09-17 and the strikethroughs are kept because both circulated:

- ~~`brazecli`, unscoped~~ — npm refused it on the first upload, in the words this ruling had
  predicted: «Package name too similar to existing package braze-cli; try renaming your package to
  '@leemour/brazecli'» (`NEED-48`). Scoped names are exempt from that check. `braze-cli` is a live
  unrelated package, `braze-cli@0.4.1`.
- ~~at v1, not before~~ — the first published version is `0.1.0` (`NEED-43`). Nobody had installed
  this on a machine other than the one that built it, and `0.x` promises nothing.

**The typed command stays `braze`** either way, set by the `bin` field, so the package name is
only ever seen in an install line. `brazectl` and a personal scope were the rejected alternatives.
The GitHub repository was renamed to [`leemour/brazecli`](https://github.com/leemour/brazecli) on
2026-09-17.

**NEED-47 · One published package, or two?**
**One: `@leemour/brazecli`.** «we don't need to run brazecli on worker so don't need to split into 2
packages… we just need this as cli on dev machines». `brazecli-core` stays `private` and is bundled
into the published binary at build time.

**The isolation stays** — the owner asked for that explicitly. Two source directories, `types: []`
on core, the linter's ban on Node APIs inside it, the neutral bundle and the bun run are all
unchanged. What changed is only what reaches the registry.

This narrows [`REQUIREMENTS.md`](REQUIREMENTS.md) §2, which called running in a Cloudflare Worker a
product requirement: the constraint is kept as an internal discipline, not as a shipped artifact.
`OPS-5` — a Worker consumer — now needs core published first, which is a decision to take then and
not before.

**NEED-49 · Release from CI or from a maintainer's machine?**
**From the machine.** «let's create a gh release and tag properly what we released in npm, we just
release not from github but from local machine». The tag-triggered workflow was deleted: it would
have needed a long-lived npm token in the repository secrets to save one command run a few times a
year, and an unarmed one turns every tag into a failed run.

The order matters and is written down in [`releasing.md`](releasing.md): publish first, then tag
the commit that was published, then write the GitHub release. A tag made before the publish records
an intention; a tag made after records a fact.

**NEED-5 · Which Braze cluster?**
**`https://rest.fra-01.braze.eu`.** The owner read it from the dashboard. Measured, not assumed:
the same key answers `403 Access Denied` there and `401 Invalid API key` on `iad-01`, and per
[Braze's error documentation](https://www.braze.com/docs/api/errors/) a 403 means the key **is**
recognised. ⚠ `blinkist-job-system/.env.development` says `iad-01` and is stale; the same repo's
`scripts/find_braze_users_without_email.rb:50` defaults to `fra-01` and was right all along. **A
value in someone's `.env` is their local setting, not a fact about the system.**

**NEED-6 · Should a profile be able to refuse writes outright?**
**Yes.** «да, пока разрабатываем, давай сделаем readonly режим». `readOnly: true` on a profile
refuses every write **before** `--confirm` is considered — `--confirm` guards against a mistyped
command, this guards against a correct command aimed at the wrong environment. Dry runs are still
allowed, deliberately: that is the tool you want most when a profile is locked down. The
production profile carries it.

**NEED-7 · A separate staging profile before any live check?**
**Not for now.** «3 - пока не заводи staging». Live checks are read-only against production
instead, and only when the owner says so.

**NEED-8 · Rotate the key after `SEC-1`?**
**Done by the owner** — the leaked key was deleted in Braze, which also confirmed why it was
being refused: it no longer existed.

**NEED-11 · Which permissions should the development key carry?**
**Read-only, and read-only across the board.** The owner issued a key with the full read set. Nine
read endpoints answer 200: campaigns, canvas and segments list; catalogs; sessions and DAU data
series; purchases product list; email templates; content blocks. Two things this rules out for a
development key, and they stay ruled out: `users.export.*` returns customer profiles, and the
email endpoints return addresses.

**NEED-3 · Are run directories ever deleted automatically?**
**No (option A).** «3 - A». Nothing expires on a timer. A run's `records.csv` is the only record
that an operation happened, and losing it silently is worse than the disk it costs. A
`braze runs cleanup` with an explicit retention setting stays in Phase 4 as `BULK-10`, opt-in
rather than default.

## 2026-09-14

**NEED-13 · Where does the API catalog come from?**
**From Braze's own Postman documenter, fetched anonymously** — this is measured, not decided, and
it settles `CAT-1` and `RISK-1`:

```text
https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG
```

That is the collection behind the page [Braze's documentation itself links
to](https://www.braze.com/docs/api/postman_collection). It answers `200` with the whole collection
as JSON — 565 438 bytes, schema v2.0.0, `info.name` "Braze Endpoints" — **with no Postman account
and no token**. 99 requests in 32 folders, covering every endpoint already confirmed live under
`NEED-11` as well as `/users/export/ids`, the case behind `FIND-13`.

So `spec:sync` downloads rather than validating a hand-made export, and no fallback is needed.
This corrects `RISK-1`, which had recorded the source as unconfirmed.

Three properties that the rest of Phase 2 is built on, each measured:

- **Repeated fetches are byte-identical.** Three downloads gave one sha256. A diff in `spec/`
  therefore means Braze changed something, which is the whole point of §7 committing the snapshot.
- **Every request carries a Postman id, and all 99 are distinct.** §9's preferred identity holds.
- **Its fallback identity does not.** Only 95 of the 99 `METHOD + path` pairs are distinct — the
  four Subscription Groups endpoints are each documented twice, once for email and once for SMS.
  Keying on method and path alone silently loses four operations, which is what §12 forbids
  (`FIND-15`).

**What was rejected.** `https://api.getpostman.com/collections/<uid>` — the documented Postman
API — answers `401 Invalid API Key`; it needs a token this repository does not have and now does
not need. [`braze-community/braze-specification`](https://github.com/braze-community/braze-specification)
republishes the same collection plus a derived OpenAPI spec, and is a reasonable fallback, but it
is explicitly not affiliated with Braze and adds a maintainer between us and the source, so the
official route wins while it works.

⚠ **The address is Postman's internal API, not a published interface** (`RISK-2`). It is what the
documenter page runs on, and Postman promises nothing about it. This costs nothing at runtime —
the committed snapshot is what ships, so a dead address breaks `spec:sync` and not the installed
CLI — but `spec:sync` must refuse to overwrite the snapshot with anything that is not a collection,
rather than quietly writing an HTML error page into `spec/`.

**NEED-16 · Where does an error go in a machine mode — stdout or stderr?**
**stderr, as one JSON object (option A).** «1 А». `{"error":{"code","message",…}}`, carrying
whatever the failure knows: `httpStatus`, `retryable`, `retryAfterMs`, `attempts`, `requestId`,
`runId`, `operation`. **stdout stays empty on a failure**, so an agent reading it can never mistake
a refusal for a result — the rule that already holds everywhere else in this CLI holds here too.
A terminal still gets `code: message` on one line. The exit code is unchanged and remains the
thing a script branches on; the JSON exists to say *which* record or *how long to wait*, which an
exit code cannot.

**NEED-17 · Merge a pull request as soon as CI is green, or wait for the owner each time?**
**Merge it (option A).** «1 A». A stack of three or four open branches makes review harder rather
than easier, and `main` falling behind has already cost a session once (`BUG-3` was invisible
precisely because nothing had ever been pushed). Phase 2's steps are internal, each behind its own
gates, so they merge on green. This is not a licence to merge anything: a change that alters
behaviour the owner has ruled on, or that touches the production profile, still asks first.

**NEED-18 · Singular or plural command names — `braze campaign list` or `braze campaigns list`?**
**Plural, as Braze's own paths are written (option A).** «2 A». `/campaigns/list` becomes
`braze campaigns list`, so nobody has to remember two spellings of the same resource, and an agent
reading a Braze doc page can type what it sees. No singularisation rule is derived: the brief
contradicts itself (`braze campaign list` in §779, `["users", "track"]` in §10's own example), and
naive plural-stripping turns `canvas` into `canva`. **The phase plan's done-criterion was written
as `braze campaign list` and is corrected to the plural.**

**NEED-19 · May an agent send a non-GET request to production Braze when the catalog calls it a read?**
**No — ask first, every time (option B).** «B». This covers `users.export.ids`,
`users.export.segment` and `users.export.global_control_group`: the catalog marks them
`access: "read"` and they change nothing, and they are **still** not to be sent to production
without asking. The rule is about the HTTP method, not about our classification of it — our
classification is exactly the thing that could be wrong, and the profile guard is the last line
before a real write.

`--dry-run` needs no permission and works on a read-only profile; use it instead. The check that
closed `FIND-13` was run before this was asked, on `POST /users/export/ids` with a deliberately
absent identifier: it returned 201 and `{"users":[],"invalid_user_ids":["nope"]}`, and wrote
nothing. That is the last one that happens without a question.

**NEED-25 · How is a profile chosen — a default, a sticky `profile use`, or named every time?**
**Named every time, and there is no default.** «ok let's allow env var along with braze
production ... using no profile for braze profile or similar is ok, no default profile».

```sh
braze staging campaigns list          # the profile is the first word
BRAZE_PROFILE=staging braze …         # or once for a shell session
braze --profile staging …             # the flag still works
```

Omitting it is an error that lists the profiles that exist. `braze profile`, `braze runs` and
`braze commands` need none, because they do not talk to Braze.

**A sticky `profile use` was rejected**, not merely skipped: it is `kubectl config use-context`,
where a command that reads perfectly is aimed by invisible state set at some earlier time,
possibly in another terminal. A default has the same flaw in weaker form — it is selected by
*omission*, and the easiest thing to omit must not be the workspace with 1.3 million people in it.

A profile may not be named after a top-level command; `profile add` refuses, because
`braze users track` would otherwise be ambiguous between a profile named `users` and the users
command.

**NEED-24 · How does a profile prove it points at the workspace you think?**
**By size, checked with `braze profile verify`.** Braze publishes no workspace identifier — no
`/me`, nothing in any response naming the workspace a key belongs to — so it cannot be checked
directly. Activity separates them cleanly where volume does not: the sandbox held just as many
user *profiles* as production but ran 502 monthly actives against 1,307,224.

`--expect-max` records a ceiling on the profile, and only when the live workspace already agrees
with it; a contradicted ceiling is never written, because that would stamp "this is the small one"
onto the large one. An exact fingerprint over campaign or segment ids was rejected: it breaks the
first time anyone adds one, and a check that cries wolf is a check people learn to skip.


**NEED-26 · Does clearer help jump ahead of pagination, since that is what the owner noticed?**
**Yes — `CAT-13` goes straight after `CAT-9` (option A).** «1 A». The order of Step 5 is therefore
`CAT-9` → `CAT-13` → `CAT-7` → `CAT-11`.

The owner looked at `braze campaigns list --help`, saw `--page <value>  query parameter (e.g. 0)`,
and read it as the flag being absent. It is not absent; it is undescribed, along with the other
133 (`UX-5`). A flag documented as "query parameter" is worse than an undocumented one, because it
looks like the documentation already happened.

It jumps the queue because it is small and it is the thing that was actually noticed: the 134
parameter slots are only **43 distinct names**, so one glossary keyed by parameter name describes
every flag on all 95 commands. Keyed by name and not by operation — `page` means the same thing
everywhere, and 134 per-operation overrides would be the bloat the owner warned against in the
same breath.

`CAT-11` explicitly does **not** come first: it needs response shapes nobody has measured
(`FIND-20`), so putting it ahead would block on live requests.

**NEED-27 · Contract tests before `braze schema`, against the backlog's "then `CAT-7`"?**
**Yes — `CAT-9` first (option A).** «2 A».

`braze schema` publishes `pathParameters`, `queryParameters` and access classification to an agent
as a contract. Nothing currently asserts that `pathParameters` matches the placeholders in `path`,
that every command builds under Commander, or that no command name is also a group. Publishing a
contract before anything checks it is true is the wrong way round, and `CAT-9` needs no new
production code — it extends `packages/core/src/operations/catalog.test.ts`, already green.

`BACKLOG.md`'s "then `CAT-7`" pointer is replaced by a link to Step 5 of the phase plan, so the
order lives in exactly one place. Two answers to "what is next" is the failure the backlog's own
rules describe.

**NEED-28 · `CAT-10` cannot be built as written — reword it or close it?**
**Reword it to "the request builds" (option A).** «3 A». Priority stays P3, after Step 5.

`CAT-10` was written as "smoke tests generated from the collection's own examples". The collection
carries **zero response examples — 0 of all 99 requests** (`FIND-20`), so there is nothing to
generate a response assertion from. It does carry **48 request-body examples**, 32 of them real
placeholder-free JSON (`FIND-17`), which support a different and still worthwhile test: that every
operation with a documented body can be turned into a request that builds.

Taking the shapes from live Braze instead was rejected: 95 live requests to capture fixtures that
go stale the first time Braze changes a response is a maintenance cost with no matching benefit.
The 🚩 is cleared.

## 2026-09-15

**NEED-30 · Is bulk a `--records` flag on the existing command, or a separate `braze bulk` verb?**
**A flag on the existing command (option A).** «1 А». `braze production users track --records
users.jsonl`. `--input` keeps its meaning — one file, one body — and passing both is an error.

A second command tree was rejected because it would put every one of the 95 generated operations
into the surface twice: in `braze commands --json`, in `docs/commands.md`, and in the tree an agent
walks to find out what exists. The operation is the same one either way; only how many records go
into it differs.

**NEED-31 · What does `records.csv` hold when a record carries no identifier?**
**The question was too narrow. Every record must carry an identifier, and it must be ours.**
«надо сделать поле id обязательным, и продумывать, чтобы была валидация данных и проверка
обязательных полей перед запросом, просто что попало не шлем. если это создание нового, все равно
должен быть у нас какой-то id, да хоть sequential row number как минимум, а в идеале что-то наше».

Two rulings, not one:

1. **`recordId` is mandatory on every record**, not optional and never blank. Where the input
   supplies one it is used; where it does not — a create, for instance — **the pipeline generates
   one** rather than leaving the audit row unactionable. A bare row number is the floor, not the
   goal: it is ambiguous the moment there is a second run or a second file, so the generated form
   is `<runId>-<row>`, unique across every run this tool has ever made and traceable to both the
   run and the input line. The audit records whether the id came from the input or from us, so a
   generated one is never mistaken for the customer's own key.

2. **Required fields are checked per record, before the request is built.** "We do not send
   whatever turns up." This goes further than `CORE-10`, which validates an assembled body: in a
   bulk run one malformed record among 75 would fail the whole batch, so each record is checked on
   its own and a bad one is `invalid` — named in the audit, never sent, and the other 74 still go.

The practical effect is that a bulk run can be wrong about a record only in ways Braze itself
introduces. Everything we can know before sending, we check before sending.

**NEED-32 · What exit code does a bulk run give when it completes with some records failed?**
**Zero, whenever the run completed (option A).** «A». A run that sent 750 000 records and had 612
refused by Braze did exactly what it was asked; the failure is in the data, not in the command.

**The summary on stdout is what a script branches on**, not the exit code. An agent deciding what
to re-send needs the number — 612 of 750 000, and which ones — and it already has to read
`records.csv` to act. An exit code cannot carry that and pretending it can invites a script that
retries the whole file.

A non-zero code on any failed record was rejected because it makes **one bad row in a
two-million-row file indistinguishable from a wrong API key**, which is the distinction exit codes
exist to make. The existing mapping still applies to everything that genuinely raises: a bad
credential, an unreadable input, a refused profile, a validation error that stopped the run before
it started.

Cheap to revisit — one line, and no data format depends on it.

## Harvested from the journals, 2026-09-23

**NEED-39 · Give the staging key `users.delete`, so a live check can clean up after itself?**
~~**Yes (option A).**~~ **Overturned 2026-09-23 by `NEED-60`: the owner cannot change permissions
on that Braze workspace.** Braze grants permissions only through the dashboard, never through its
REST API, so this was never ours to do. The two profiles stay — see `NEED-60`.

**NEED-46 · Put `NPM_TOKEN` in the repository secrets so a release workflow can run?**
**Moot — `NEED-49` removed the workflow.** Releases are made from a maintainer's machine, so no
token is stored anywhere but the owner's keyring. If that is ever revisited it is `OPS-6`, and
npm's trusted publishing over OIDC should be checked first because it stores no token at all.

**NEED-53 · Remove the two staging user profiles the `RISK-3` measurement created?**
**No — leave them.** «just leave these users». They carry one attribute, `brazecli_test: true`.
Closed for good by `NEED-60`.

## 2026-09-23

**NEED-50 · Publish `main` when its only unreleased commit changes nothing a user can see?**
**No — wait for a real change (option A).** «1 A». `main` was one commit ahead of the published
`0.1.1`, and that commit only added secret scanning to CI and the git hooks: nothing in the
installed command moved, so the tarball built from `main` was the one already in the registry. A
version number that buys the user nothing still costs them an update, and npm numbers can never be
reused.

**NEED-56 · Build `SEC-2` now, or the three quick wins first?**
**`SEC-2` first (option A).** «1 A». It is the only open item where somebody else's text controls
what our tool prints — a campaign name edited in the Braze dashboard can carry terminal control
sequences that overwrite our own output, and `records.csv` can carry a cell Excel executes. The
design was already written on 2026-09-18.

**NEED-57 · Does `SEC-2` justify a release on its own?**
**No — one release for all four (option B).** «2 B». One release carries `SEC-2`, `CORE-11`,
`BULK-10` and `DOC-3`, published once when all four have landed, per [`releasing.md`](releasing.md).

**It is `0.2.0`, not `0.1.2`** — corrected 2026-09-23 on the owner's call: «with quick wins it's
0.2.0». `braze runs cleanup` is a new command, and a new command is a minor bump even at `0.x`.

**NEED-58 · Delete the journals older than a week, once harvested?**
**Yes (option A).** «1 A». The ten files from 13–18 September go after their `NEED-nn` rulings are
in this file and any finding still true is a backlog line or a paragraph in
[`ARCHITECTURE.md`](ARCHITECTURE.md). The journal's own retention is one week.

**NEED-60 · Keep tracking the two staging test profiles, or close the item?**
**Close it.** «drop this from the backlog, can't update permissions in Braze so this stays». The
owner cannot grant `users.delete` on that workspace, so the profiles `brazecli-risk3-1` and
`brazecli-risk3-3` are permanent. They carry one attribute, `brazecli_test: true`, and nothing
depends on their absence. The line is gone from `docs_ai/CLEANUP.md`; this entry is why.

**A live check must not leave a profile behind again.** Nothing can remove one afterwards, so the
constraint moves to the front: use an existing profile, or a dry run. `OPS-4` carries it.
