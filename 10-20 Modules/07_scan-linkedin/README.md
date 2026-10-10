# 07_scan-linkedin

## Why it was built

Some jobs only appear on LinkedIn. The company portal scanner doesn't see them,
and the job page requires login, so this module doesn't try to read the
description.

## What it does

Searches three times (remote, Brazil, and Portugal) with a single keyword,
built from the profile's job titles, and puts new ones in the inbox. The job
enters without text. The logged-in Chrome is not part of this module.

`--dry-run` queries the source and doesn't write. `--test` uses one job title
and five results per run. Without a job title in the profile, there's no run
and no network.

## How it fits the architecture

It's an inbox entry point, sibling of Gupy and Indeed. Lives outside the
checkout and doesn't import those modules. The one that downloads the
description, when the page allows, is the next step. Details in
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md)
and in the plan [`09-scan-linkedin.md`](../../90-99%20Archive/91%20implemented%20plans/09-scan-linkedin.md).

## Last updated

2026-10-08

## Compatible with

career-ops v1.35.0

## How to use

```bash
npm run scan:linkedin:dry
npm run scan:linkedin
npm run jd:gather
```
