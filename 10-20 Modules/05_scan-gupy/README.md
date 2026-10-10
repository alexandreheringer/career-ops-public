# 05_scan-gupy

## Why it exists

Most Brazilian companies post on Gupy, and the career-ops portal scanner
doesn't read this board. The old search lived in a single file that would
disappear on the next career-ops update.

## What it does

Searches for jobs using short terms (Gupy returns an empty list if the search
is long) and puts new ones in the inbox. It doesn't download the job
description and doesn't evaluate anything. One run writes to the inbox once
only.

`--dry-run` queries the source and doesn't write. `--test` limits to three
terms, for a cheap proof.

## How it fits the architecture

It's an inbox entry point, sibling of the Teal import. Lives outside the
checkout. Details in
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md)
and in the plan [`07-scan-gupy.md`](../../01-09%20System/03%20Plans/07-scan-gupy.md).

## Last updated

2026-10-08

## Compatible with

career-ops v1.35.0

## How to use

```bash
npm run scan:gupy:dry
npm run scan:gupy
npm run jd:gather
```
