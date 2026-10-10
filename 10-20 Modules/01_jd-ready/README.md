# 01_jd-ready

## Why it exists

Without the job posting text, any evaluation invents a convincing report about
a login page. This module exists to answer one question only, honestly: **does
this URL have a real job description?**

## What it does

Keeps a simple index (one line per URL) saying `ready` or `missing`. When text
is missing, it tries to fetch it — first via the job site's API, then via a
regular page, and only if you ask, by opening a browser. LinkedIn and pages
that require login stay `missing`. That's the correct result.

The text is stored in `career-ops/jds/`. The index is just a map; deleting it
doesn't delete the jobs. Running again rebuilds the map.

## How it fits the architecture

It's the base layer. The other three modules read this index before evaluating
or showing the blue tick on screen. Contract details:
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md) §5.

## Last updated

2026-10-06

## Compatible with

career-ops v1.35.0

## How to use

```bash
npm run jd:gather:dry
npm run jd:gather
npm run jd:gather -- --browser
```
