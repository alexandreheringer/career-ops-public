# 02_search-teal

## Why it exists

Pasting job URLs one by one doesn't scale. Teal already keeps a curated
shortlist in a CSV. This module puts that list in the career-ops inbox without
manually rewriting the jobs file — which would silently break the format.

## What it does

You export the CSV from Teal, drop it in this module's `inbox/` folder and run
the import. It ignores dead jobs or those without URL, doesn't duplicate what's
already in the pipeline, respects the blocked companies list, and marks each
new job as `missing` in the job description index. The CSV goes to
`processed/` — it's never deleted.

It does **not** fetch the job text. Most Teal URLs are LinkedIn, which requires
login. The one that tries to get the description is `01_jd-ready`.

## How it fits the architecture

It's one of the two pipeline entry points (the other is the career-ops
scanner). Writes to inbox and index; evaluates nothing. See
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md) §6.

## Last updated

2026-10-06

## Compatible with

career-ops v1.35.0

## How to use

```bash
# 1. drop the CSV in 10-20 Modules/02_search-teal/inbox/
npm run teal:import:dry
npm run teal:import
npm run jd:gather -- --browser
```
