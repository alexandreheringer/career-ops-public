# 06_scan-indeed

## Why it was built

Indeed posts international and Brazilian jobs that aren't in an ATS that
career-ops already knows how to read. The checkout has no Indeed reader, and
the old search would disappear on the next update.

## What it does

Searches three times (remote, Brazil, and Portugal) with a single query, built
from the profile's job titles, and puts new ones in the inbox. It doesn't
download the job description and doesn't evaluate anything. One run writes to
the inbox once only.

`--dry-run` queries the source and doesn't write. `--test` uses one job title
and six results per run.

## How it fits the architecture

It's an inbox entry point, sibling of Gupy. Lives outside the checkout and
doesn't import the Gupy module. Both write through the same `appendToPipeline`.
Details in
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md)
and in the plan [`08-scan-indeed.md`](../../90-99%20Archive/91%20implemented%20plans/08-scan-indeed.md).

## Last updated

2026-10-08

## Compatible with

career-ops v1.35.0

## How to use

```bash
npm run scan:indeed:dry
npm run scan:indeed
```
