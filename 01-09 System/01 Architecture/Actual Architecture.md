# System Architecture — career-ops + local plugins

> Living document. Describes **how the pieces fit together** and **which rules
> no plugin may break**. Before editing this file, copy it to
> `01-09 System/02 Old Architectures/YYYY-MM-DD.md`. Plans not yet
> implemented live in `01-09 System/03 Plans/`. Already delivered plans
> are in `90-99 Archive/91 implemented plans/`.

**Status verified on 2026-10-01:** `career-ops` v1.35.0 (web 0.13.0, Next 16.3.4),
389 pending jobs in `career-ops/data/pipeline.md`, 327 rows in
`career-ops/data/scan-history.tsv` (264 with fingerprint), **0 files** in
`career-ops/jds/`, tracker `career-ops/data/applications.md` empty (header only).

---

## 1. The problem this architecture solves

`career-ops` is a third-party project that you update. The updater
(`career-ops/update-system.mjs`) **overwrites the entire system layer** —
`scan.mjs`, `providers/`, `modes/`, `web/`, `plugins/`. Any improvements of yours
written inside these files vanish on the next `npm run update`, without warning
and without merge conflicts to alert you.

So the question is not "where do I put my code". It is: **what will still exist
after the next update?** Three answers, in order of safety:

| Location | Survives the update? | Purpose |
|---|---|---|
| Sibling directories to `career-ops/` | Yes, trivially — they are outside the checkout | All of our code |
| `career-ops/data/`, `jds/`, `portals.yml`, `config/` | Yes — user layer, listed in `USER_PATHS` | Data, not code |
| `career-ops/scan.mjs`, `web/`, `providers/`, `modes/` | **No** | None of our code |

The architecture is the first row: **the code is entirely ours and lives outside**.
`career-ops` is consumed as if it were an installed library.

---

## 2. The two layers of career-ops

This is documented in `career-ops/DATA_CONTRACT.md`. The operational summary:

### User layer — we can read and write

```text
career-ops/data/pipeline.md          job inbox (our input channel)
career-ops/data/applications.md      tracker (our output channel, via merge)
career-ops/data/scan-history.tsv     scanner history (read-only for us)
career-ops/data/blacklist.md         blacklisted companies (read-only)
career-ops/jds/                      job description text (we write)
career-ops/batch/                    batch execution state
career-ops/reports/                  evaluation reports
career-ops/cv.md, config/profile.yml candidate context (read-only)
career-ops/portals.yml               search targets (read-only for us)
```

### System layer — untouchable

```text
career-ops/scan.mjs            and all other .mjs in the root
career-ops/providers/          98 ATS modules
career-ops/modes/              prompts (except _profile.md, _custom.md, _brief.md)
career-ops/web/                the Next.js app
career-ops/plugins/            bundled plugins
career-ops/update-system.mjs   the updater itself
```

**Important nuance:** `career-ops/` is in the root `.gitignore`. This means
that a commit of ours **does not protect** an edit made inside it — it is not
versioned here and it is not versioned there (the checkout has its own git that update
overwrites). An edit in `career-ops/web/` exists only on your disk. That is why
the `dashboard/` plugin stores **patches**, not edited files.

### How career-ops resolves paths

Two roots, not one:

- **CODE root** — where the `.mjs` files and `web/` reside. It is the checkout.
- **DATA root** — where `data/`, `jds/`, `cv.md` reside. Resolved by
  `career-ops/path-resolver.mjs` → `getCareerOpsRoot()`, with precedence:
  `CAREER_OPS_ROOT` env → marker file `.career-ops-data` → the checkout itself.

Today both coincide (`./career-ops/`). Our plugins **never hardcode
data paths**: they import `getCareerOpsRoot()`. If you ever separate
code from data, the plugins will continue working.

---

## 3. Why not use the career-ops plugin system

`career-ops` has a real plugin engine (`career-ops/plugins/_engine.mjs`,
`config/plugins.yml`, `plugins.local/`). It does not work here, and the reason is
specific:

```js
// career-ops/plugins/_engine.mjs:35
export const HOOK_KINDS = ['provider', 'ingest', 'search', 'notify', 'export'];
```

Five hooks, and the list is closed:

| Hook | What it does | Useful for us? |
|---|---|---|
| `provider` | fetches jobs from an ATS listed in `portals.yml` | No — we are not adding an ATS |
| `ingest` | pulls jobs from an external source (Gmail, etc.) | **Partially** — `search-teal` would fit here |
| `search` | ad-hoc search by query | No |
| `notify` | notification | No |
| `export` | pushes snapshot externally (Notion) | No |

**There is no UI hook.** The blue tick, the Job Description filter, the SKIP tab,
and the removal of the Intern chip are changes in the Next.js app in `career-ops/web/`. The
plugin engine has no extension point that can reach this. That is the core
reason why `dashboard/` is a patch applicator and not a registered plugin.

And there is no hook for "collecting the description of a job already in the pipeline".
`ingest` produces new jobs; it does not enrich existing jobs.

**Decision:** we do not register anything in `config/plugins.yml`. Our plugins are
sibling Node scripts that import `career-ops` via relative paths.
`search-teal` could become an `ingest` plugin in the future — this is noted in its
plan as a possible evolution, not a requirement.

---

## 4. Folder map

```text
21.15-New-Career-Ops/
├── career-ops/                         upstream. Gitignored. Not our plugin.
├── 00.alex_input/                      candidate context. Input, not code.
├── 01-09 System/
│   ├── 01 Architecture/
│   │   └── Actual Architecture.md      this file (living)
│   ├── 02 Old Architectures/           dated snapshots
│   ├── 03 Plans/                       plans not yet implemented
│   └── 04 Playbooks/                   playbooks (ESLint + Actions)
├── 10-20 Modules/
│   ├── 01_jd-ready/                    BASE LAYER: contract "does this job have a JD?"
│   │   ├── pipeline-entry.mjs
│   │   ├── jd-ready.mjs
│   │   ├── gather.mjs
│   │   ├── jd-fetch.mjs
│   │   └── jd-ready.tsv                ← runtime, gitignored
│   ├── 02_search-teal/                 Teal CSV → pipeline line
│   ├── 03_batch-anthropic/             evaluation via Message Batches API
│   ├── 04_dashboard/                   patches for the career-ops Next app
│   ├── 05_scan-gupy/                   Gupy search → pipeline line
│   ├── 06_scan-indeed/                 Indeed search → pipeline line
│   └── 07_scan-linkedin/               LinkedIn search → pipeline line
├── 90-99 Archive/
│   ├── 91 implemented plans/           implementation logs
│   └── 92 discarded plans/
├── career-ops-root.mjs                 PROJECT_ROOT, CAREER_OPS_ROOT, module dirs, JD_INDEX_PATH
├── AGENTS.md
└── package.json
```

`career-ops-root.mjs` in the root is the only place that knows where the checkout and the
modules are located. Every plugin imports `../../career-ops-root.mjs`. Moving the
checkout or a module requires one edit, not four.

### Dependency graph

```text
                    ┌─────────────┐
                    │ 01_jd-ready │  base: parser + index. No network in the core.
                    └──┬───┬───┬──┘
         ┌─────────────┘   │   └─────────────┐
         ▼                 ▼                 ▼
  ┌─────────────┐  ┌───────────────┐  ┌───────────┐
  │02_search-teal│ │03_batch-anthropic│ │04_dashboard│
  └─────────────┘  └───────────────┘  └───────────┘
         │                 │                 │
         └────────── all import ─────────────┘
                           ▼
                   ┌───────────────┐
                   │  career-ops/  │  (scan.mjs, fetch-jd.mjs, path-resolver)
                   └───────────────┘
```

`jd-ready` is the base because it **defines the contract** and because it
owns `pipeline-entry.mjs` — the line parser for `pipeline.md`. This parser is
a copy of helpers that `career-ops/scan.mjs` keeps private (does not export
`extractPipelineUrl` or `extractPipelineCompanyRole`). It used to exist in
the legacy `70-79-automation/` (removed) and **changes ownership** to
`10-20 Modules/01_jd-ready/`, so that there is one copy instead of four.

No plugin depends on another product plugin. `search-teal`, `batch-anthropic`,
and `dashboard` can be implemented in parallel, as long as `jd-ready`
exists first. `05_scan-gupy`, `06_scan-indeed`, and `07_scan-linkedin`
also do not read the TSV: each one only appends a line to the inbox, via
career-ops's `appendToPipeline`, and does not mark a job description. None
imports another. LinkedIn does not download the job description.

---

## 5. The contract: `10-20 Modules/01_jd-ready/jd-ready.tsv`

A TSV file. One line per URL. It is the **single** source of truth for "can this
job be evaluated?".

```text
url	status	jd_path	chars	updated
https://jobs.ashbyhq.com/acme/1	ready	jds/acme-data-engineer.md	4821	2026-10-01
https://www.linkedin.com/jobs/view/4413774319	missing		0	2026-10-01
```

| Column | Meaning |
|---|---|
| `url` | the exact URL found in `pipeline.md`. Row key. |
| `status` | `ready` or `missing`. Nothing else. |
| `jd_path` | path relative to **career-ops DATA root** (e.g. `jds/acme.md`). Empty when `missing`. |
| `chars` | text length in characters. Serves as diagnostic, not as a gate. |
| `updated` | local date `YYYY-MM-DD` of the last change to this row. |

**`ready` requires two things simultaneously:** the file exists in
`career-ops/jds/` and contains at least **400 useful characters**. 400 is the same floor that
`batch-api-submit.mjs` already applies (`JD_MIN_CHARS`) and that the former
`jd-fetch-core.mjs` applied. A single number, in a single place.

### Who writes, who reads

```text
WRITES                           READS
──────                           ─────
01_jd-ready/gather.mjs ──────►   03_batch-anthropic/batch-api-submit.mjs
02_search-teal (markMissing)     04_dashboard (via read-jd-index.mjs)
```

**The TSV is disposable.** Deleting `10-20 Modules/01_jd-ready/jd-ready.tsv` loses nothing
irretrievable: the JD text lives in `career-ops/jds/`, and running
`npm run jd:gather` rebuilds the index from existing
files. That is why it is gitignored — and why job posting text is **not**
committed (it is third-party content).

### Why a sidecar TSV, and not a mark on the pipeline line

`career-ops` supports labeled inline segments (`note:`, `trust:`, `posted:`,
`rank:`) and supports replacing the URL with `local:jds/file.md`. Two real
alternatives, both rejected:

- **`local:jds/x.md` replacing the URL** — this is what the legacy project did
  (`toLocalLine` in `jd-fetch-core.mjs`). It destroys the URL. The legacy repo needed an
  entire script (`reset-batch-virgin.mjs`) just to recover the URL by reading the
  `Source:` line inside the `.md` file. It is a disguised point of no return.
- **`note: jd-ready`** — the line in `pipeline.md` has 4+ concurrent writers
  (`scan.mjs`, `rank-pipeline.mjs`, dashboard, plugins). Our state would be
  subject to being overwritten by any of them.

The sidecar TSV keeps the URL intact, does not contend with any writer, and is
rebuildable. The cost is one extra file — cheap.

---

## 6. The end-to-end flow

The original request was not a set of features. It was a flow:

```text
search → collect JD if missing → evaluate only those with JD
```

In terms of files:

```text
  ┌──────────────┐         ┌──────────────┐
  │ career-ops   │         │ 02_search-teal│   Teal CSV in 02_search-teal/inbox/
  │ scan.mjs     │         │ import-teal  │
  └──────┬───────┘         └──────┬───────┘
         │  appendToPipeline      │  appendToPipeline + markMissing
         └───────────┬────────────┘
                     ▼
        ╔════════════════════════════════════╗
        ║ career-ops/data/pipeline.md        ║  inbox
        ║ - [ ] {url} | {company} | {role}   ║  (389 pending today)
        ╚════════════════┬═══════════════════╝
                         │ reads pending lines
                         ▼
              ┌─────────────────────┐
              │ 01_jd-ready/gather  │  1. career-ops/fetch-jd.mjs (ATS API)
              │                     │  2. HTTP + tag strip
              │                     │  3. Playwright (--browser)
              └────┬───────────┬────┘
     writes the text│          │writes status
                   ▼           ▼
   ╔═══════════════════╗  ╔══════════════════════╗
   ║ career-ops/jds/   ║  ║ 01_jd-ready/jd-ready.tsv║  the contract
   ║ {company}-{role}  ║  ║ url  status  jd_path ║
   ║ .md               ║  ╚═══════╦════════╦═════╝
   ╚═════════╦═════════╝          ║        ║
             ║                    ║        ║
             ╚════════╦═══════════╝        ║
                      ▼                    ▼
        ┌──────────────────────────┐  ┌──────────────────────┐
        │ 03_batch-anthropic       │  │ 04_dashboard (patches)│
        │ only status=ready enters │  │ blue tick · JD filter│
        │ the batch; reads text    │  │ · Save locked without│
        │ from jds/ instead of     │  │ JD                   │
        │ re-fetching              │  └──────────────────────┘
        └────────────┬─────────────┘
                     ▼
     career-ops/batch/tracker-additions/*.tsv
                     │ career-ops/merge-tracker.mjs
                     ▼
        career-ops/data/applications.md   tracker
```

### Where the gate is, exactly

Three paths lead to a job being evaluated. **All three consult the same TSV:**

| Path | Gate | File |
|---|---|---|
| Paid batch on Anthropic | `isReady(index, url)` before entering `candidates` | `10-20 Modules/03_batch-anthropic/batch-api-submit.mjs` |
| Agent, via "Score shortlist" on dashboard | `save()` and `scoreShortlist()` reject `hasJd === false` | patch in `inbox-triage.tsx` |
| Agent, via career-ops CLI | **not covered** — see §10 | — |

The visual "Job Description" filter in the dashboard is **convenience**, not a gate. It can
be toggled off and Save remains locked. Filter and lock are separate things, by
design: a filter that is also a lock confuses the user.

---

## 7. Real-world data, and why the gate matters

The 389 pending jobs as of 2026-10-01, grouped by URL domain — which is how
`career-ops/fetch-jd.mjs` decides whether it knows the route:

| Group | Count | What happens |
|---|---|---|
| Greenhouse, Lever, Ashby, Workday | **171** | `fetch-jd.mjs` resolves via the ATS public JSON API |
| Other boards (Allianz, SolidJobs, BMW, Volkswagen, Nortal, Gupy…) | **141** | `fetch-jd.mjs` exits with code 1. Requires HTTP or Playwright. |
| LinkedIn (almost all coming from Teal) | **77** | Login wall. They stay `missing`, and that is the correct result. |

The 141 in the middle are the reason the collector has three strategies and not one. Without the
browser layer, **36% of the pipeline** would stay `missing` due to lack of rendered
JavaScript — jobs whose text is public.

Evaluating the third group produces a confident report about a login page.
This is the worst possible result, because **it looks like a result**. It is literally
the reason this system exists.

Note on `fingerprint` (column 8 of `scan-history.tsv`): it is a 16-hex
SimHash of the body returned by the ATS API in the listing. A non-empty fingerprint is a **clue**
that retrievable text exists, not proof — and it is not the text. The gate remains
the file in `jds/`.

---

## 8. Dependency resolution and root `package.json`

The plugins need four external things:

| Dependency | Who uses it | Where it comes from |
|---|---|---|
| `@anthropic-ai/sdk` | `03_batch-anthropic/batch-api-submit.mjs` (lazy import) | Root `package.json` |
| `dotenv` | `03_batch-anthropic` (lazy import, optional) | Root `package.json` |
| `js-yaml` | `03_batch-anthropic/batch-api-collect.mjs` (static import) | Root `package.json` |
| `playwright` | `npm run jd:gather -- --browser` | **`career-ops/node_modules`**, via `createRequire` |

### The resolution rule that dictates this table

Node resolves bare specifiers by walking up the directory tree **starting from
the importing file**, and never enters a sibling folder. Modules in
`10-20 Modules/03_batch-anthropic/` go up
`03_batch-anthropic → 10-20 Modules → root` and find the root `node_modules`.

That is why everything a plugin imports **by name** must be in the root
`package.json`. The painful case is `js-yaml`: static import in collect, and no
test in the dry-run path touches it.

Dependencies that `career-ops` imports for itself continue resolving from
`career-ops/node_modules` — `scan.mjs` imports `js-yaml` from inside the
checkout, so that resolution is not our concern. Ours is only for the
files where our code lives.

**Playwright is not added to our `package.json`.** `career-ops` already pins
`playwright: 1.63.0` and already has the browsers downloaded. Installing a second copy
creates risk of version divergence between binary and API. We resolve it from
the checkout:

```js
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CAREER_OPS_ROOT } from '../../career-ops-root.mjs';

// Resolves playwright from career-ops: same version tested upstream,
// same browsers already downloaded, zero duplicated installations.
const requireFromCareerOps = createRequire(join(CAREER_OPS_ROOT, 'package.json'));
const { chromium } = requireFromCareerOps('playwright');
```

The root `package.json` also consolidates commands, so no one needs to
remember paths:

```json
{
  "scripts": {
    "jd:gather": "node \"10-20 Modules/01_jd-ready/gather.mjs\"",
    "jd:gather:dry": "node \"10-20 Modules/01_jd-ready/gather.mjs\" --dry-run",
    "teal:import": "node \"10-20 Modules/02_search-teal/import-teal.mjs\"",
    "batch:submit:dry": "node \"10-20 Modules/03_batch-anthropic/batch-api-submit.mjs\" --dry-run",
    "batch:submit": "node \"10-20 Modules/03_batch-anthropic/batch-api-submit.mjs\"",
    "batch:collect": "node \"10-20 Modules/03_batch-anthropic/batch-api-collect.mjs\"",
    "dashboard:apply": "node \"10-20 Modules/04_dashboard/apply.mjs\"",
    "dashboard:check": "node \"10-20 Modules/04_dashboard/apply.mjs\" --check",
    "scan:gupy": "node \"10-20 Modules/05_scan-gupy/scan-gupy.mjs\"",
    "scan:gupy:dry": "node \"10-20 Modules/05_scan-gupy/scan-gupy.mjs\" --dry-run",
    "scan:indeed": "node \"10-20 Modules/06_scan-indeed/scan-indeed.mjs\"",
    "scan:indeed:dry": "node \"10-20 Modules/06_scan-indeed/scan-indeed.mjs\" --dry-run",
    "scan:linkedin": "node \"10-20 Modules/07_scan-linkedin/scan-linkedin.mjs\"",
    "scan:linkedin:dry": "node \"10-20 Modules/07_scan-linkedin/scan-linkedin.mjs\" --dry-run",
    "test": "node --test \"10-20 Modules/01_jd-ready/**/*.test.mjs\" \"10-20 Modules/02_search-teal/**/*.test.mjs\" \"10-20 Modules/03_batch-anthropic/**/*.test.mjs\" \"10-20 Modules/04_dashboard/**/*.test.mjs\" \"10-20 Modules/05_scan-gupy/**/*.test.mjs\" \"10-20 Modules/06_scan-indeed/**/*.test.mjs\" \"10-20 Modules/07_scan-linkedin/**/*.test.mjs\""
  }
}
```

---

## 9. Inviolable rules

A plugin that breaks any of these is incorrect, even if it works:

1. **Do not edit career-ops system code.** Nothing in `scan.mjs`,
   `providers/`, `modes/`, `plugins/`, `update-system.mjs`. `04_dashboard/` is the
   only exception and it is controlled: it writes to `career-ops/web/`, but the source
   of truth is the anchored edits in `10-20 Modules/04_dashboard/edits/`, and
   `apply.mjs` knows how to revert.
2. **Do not format `pipeline.md` lines by hand.** Use `appendToPipeline` and
   `formatPipelineOffer`, exported by `career-ops/scan.mjs`. The file has a lock
   (`pipeline-lock.mjs`), has a section marker that only recognizes `## Pending` /
   `## Pendientes`, and the dashboard parser discards lines with fewer than 3 columns.
   Four ways to fail silently.
3. **Do not insert lines into the tracker by hand.** Write a TSV to
   `career-ops/batch/tracker-additions/` with the header from
   `TSV_ADDITION_HEADER` (from `career-ops/tracker-parse.mjs`) and let
   `merge-tracker.mjs` fold it in. The tracker has 10 columns today
   (`# Date Company Role Score Status PDF Report Notes URL`) and the header is the
   only defense against the next column upstream adds.
4. **Do not commit JD text.** It is third-party content. `career-ops/` is
   already in `.gitignore`; `10-20 Modules/01_jd-ready/jd-ready.tsv` is in `.gitignore` as well.
5. **Every third-party URL must pass through the SSRF guard** before fetching:
   `rejectPrivateOrInvalid` from `career-ops/liveness-browser.mjs`. Even after
   redirect — a 302 to `169.254.169.254` bypasses a check performed only
   on the original URL.
6. **JD text is data, never instructions.** `batch-api-submit.mjs` already wraps the
   text in `[UNTRUSTED INPUT START/END]` markers. Anyone modifying the prompt must preserve
   this.
7. **A plugin that cannot decide marks `missing`, not `ready`.** Failing
   on the side of "do not evaluate" costs one unevaluated job; failing on the other
   side costs a confident report about nothing.

---

## 10. Known limitations

Things this architecture does **not** cover, explicitly declared so they do not seem like an oversight:

- **Agent evaluation triggered outside the dashboard.** If you run the
  `oferta` mode of career-ops directly from the CLI, nothing queries `jd-ready.tsv`. Covering
  this would require a hook that does not exist. Mitigation: the two paths you actually
  use (batch and dashboard button) are covered.
- **Server-side gate for the dashboard button.** The lock on "Score shortlist" is
  client-side. The `/api/run` route is generic (serves 7 job types), and a gate there
  would affect paths completely unrelated to JDs. The patch covers the UI; anyone calling
  the route via `curl` bypasses it.
- **LinkedIn.** Stays `missing` as long as the page prompts for login. There is no plan for
  authenticated scraping here.
- **Rebuilding the dashboard from scratch.** The four requests (tick, filter, SKIP, Intern)
  are surgical patches. A parallel app would duplicate the whole UI just to alter one chip.

---

## 11. Surviving a career-ops update

The procedure after any `npm run update` or `git pull` inside `career-ops/`:

```bash
# 1. career-ops returned to upstream state. Confirm it is clean.
git -C career-ops status --short

# 2. Reapply dashboard patches. If a chunk changed, apply STOPS.
npm run dashboard:apply

# 3. Verify that the contracts we import still exist.
npm test

# 4. Dry-runs. None of them write anything.
npm run jd:gather:dry
npm run teal:import:dry
npm run batch:submit:dry
```

### What can break, and how you find out

| Upstream changed | Symptom | Where to fix |
|---|---|---|
| `scan.mjs` stopped exporting `appendToPipeline` | `02_search-teal` fails on import | `10-20 Modules/02_search-teal/teal-import-core.mjs` |
| `fetch-jd.mjs` changed stdout contract | `gather` marks everything `missing` | `10-20 Modules/01_jd-ready/jd-fetch.mjs` |
| `TSV_ADDITION_HEADER` gained a column | `merge-tracker` rejects addition | nothing — the header is read, not hardcoded |
| `triage-row.tsx` changed the patch chunk | `npm run dashboard:apply` fails and stops | update `04_dashboard/edits/` |
| `scan.mjs` started exporting pipeline helpers | nothing breaks | opportunity: `01_jd-ready/pipeline-entry.mjs` can become a re-export |

**That is the design goal:** every coupling with upstream is a test that
fails loudly, not a behavior that degrades silently. `apply.mjs` stops instead
of writing half a file. `gather` marks `missing` instead of inventing text.

---

## 12. Implementation order

| # | Plugin | Plan | Depends on | Why in this position |
|---|---|---|---|---|
| 1 | `01_jd-ready` (contract) | [`01-jd-ready-contrato.md`](../../90-99%20Archive/91%20implemented%20plans/01-jd-ready-contrato.md) | nothing | Defines the TSV. Everything else reads it. Pure, no network, in-memory testable. |
| 2 | `01_jd-ready` (gather) | [`02-jd-gather.md`](../../90-99%20Archive/91%20implemented%20plans/02-jd-gather.md) | 1 | Populates the TSV. Without it, everyone reads an empty file. |
| 3 | `02_search-teal` | [`03-search-teal.md`](../../90-99%20Archive/91%20implemented%20plans/03-search-teal.md) | 1 | Independent of 2. Can run in parallel. |
| 4 | `03_batch-anthropic` | [`04-batch-anthropic.md`](../../90-99%20Archive/91%20implemented%20plans/04-batch-anthropic.md) | 1 | First consumer of the gate. |
| 5 | `04_dashboard` | [`05-dashboard.md`](../../90-99%20Archive/91%20implemented%20plans/05-dashboard.md) | 1 | Second consumer. Most fragile to update — last. |
| 6 | `05_scan-gupy` | [`07-scan-gupy.md`](../../90-99%20Archive/91%20implemented%20plans/07-scan-gupy.md) | nothing besides career-ops | Gupy inbox. Does not read TSV. Independent of 1–5. |
| 7 | `06_scan-indeed` | [`08-scan-indeed.md`](../../90-99%20Archive/91%20implemented%20plans/08-scan-indeed.md) | nothing besides career-ops | Indeed inbox. Does not read TSV. Does not import Gupy. |
| 8 | `07_scan-linkedin` | [`09-scan-linkedin.md`](../../90-99%20Archive/91%20implemented%20plans/09-scan-linkedin.md) | nothing besides career-ops | LinkedIn inbox. Does not read TSV. Does not download JD. |

Steps 3, 4, and 5 can be parallelized. 1 → 2 is sequential. Steps 6,
7, and 8 are not part of the network-free verification: `scan:gupy:dry`, `scan:indeed:dry`,
and `scan:linkedin:dry` call Apify.

---

## 13. Final overall verification

This is the check that confirms "the system is correct AND career-ops was not corrupted":

```bash
# contracts
npm test

# dry-runs, none of them write
npm run jd:gather:dry
npm run teal:import:dry
npm run batch:submit:dry

# patches are applied and they are ours
npm run dashboard:check

# THE PROOF: career-ops only has changes declared by apply.mjs.
git -C career-ops status --short
# No scan.mjs, providers/, modes/, or update-system.mjs in the list.
```
