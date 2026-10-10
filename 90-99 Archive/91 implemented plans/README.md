# Implementation Plans

> **Historical.** These files describe how the modules were built.
> The code lives in `10-20 Modules/`. The living architecture is
> [`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md).

One plan per plugin. Each one produces working and testable software on its
own. Read the living architecture first — it has the contract all five share
and the rules none of them can break.

The files are in two folders, in **numerical order** (not by date):

- [`implementados/`](implementados/) — the code is already there (or is in this
  branch, awaiting merge)
- [`a-implementar/`](a-implementar/) — there's no delivery in git yet

When a plan is done, the file moves from `a-implementar/` to `implementados/`.
The number doesn't change.

## Implemented

| # | Plan | Delivery |
|---|---|---|
| 01 | [`jd-ready` — the contract](implementados/01-jd-ready-contrato.md) | `jd-ready.tsv`, the pipeline parser, root `package.json` |
| 02 | [`jd-ready` — the collector](implementados/02-jd-gather.md) | `gather.mjs`: three fetch strategies, text in `career-ops/jds/` |
| 03 | [`search-teal`](implementados/03-search-teal.md) | Teal CSV in `search-teal/inbox/` → pipeline + `missing` |
| 04 | [`batch-anthropic`](implementados/04-batch-anthropic.md) | the batch only evaluates what's `ready`, and reads text from disk |
| 05 | [`dashboard`](implementados/05-dashboard.md) | blue tick, JD filter, SKIP tab fixed, Intern chip gone |
| 06 | [`ESLint + Prettier + Husky + Actions`](implementados/06-eslint-ci.md) | `npm run verify` local, `pre-push`, CI (lint + format:check + test) on a clone **without** `career-ops/` |

06 is tooling, not a plugin. It got number 06 because the five plugins were
already numbered; execution order was `01 → 02 → 06`, so 03–05 were born under
the tooling.

## To implement

None. The five plugins and tooling (06) are in `implementados/`.

Tutorial for 06: [`eslint-e-github-actions.md`](../../01-09%20System/04%20Playbooks/eslint-e-github-actions.md).

## Order

`01 → 02 → 06 → 03 → 04` already existed in this order. **Don't run 02 and 03
at the same time**: both rewrite `jd-ready/jd-ready.tsv` entirely
(read-modify-write), and the last write wins. `05` is parallelizable with 04
after `01`, as long as `03` doesn't coincide with `02`. Do `05` last anyway:
it's the only one that writes inside `career-ops/web/` and the most sensitive
to an upstream update.

## What each plan proves at the end

All end with the same verification, and that's the point:

```bash
git -C career-ops status --short
```

No `scan.mjs`, `providers/`, `modes/`, `plugins/` or `update-system.mjs` in
that list. Only user layer (`jds/`, `batch/`) and, in plan 05, the six `web/`
files that `dashboard/apply.mjs` declares and knows how to revert.

## Origin

These five came from the original parent plan (`PLANO-JD-E-PLUGINS.md`,
removed; git keeps the history). The reusable code came from
[`alexandreheringer/21.11-Career-Ops`](https://github.com/alexandreheringer/21.11-Career-Ops),
the previous project — mainly the JD selectors by ATS and the login wall
detector from `jd-fetch-core.mjs`, which solve the jobs that the ATS API
doesn't reach.
