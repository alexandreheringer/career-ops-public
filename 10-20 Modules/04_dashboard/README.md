# 04_dashboard

## Why it exists

The career-ops `/pipeline` screen doesn't know if a job has a job description.
Without this, you can save and evaluate a login page. The Next app is a system
layer: any edit made inside it disappears on the next update. This module keeps
the changes **here** and reapplies them when upstream changes.

## What it does

Four adjustments to the screen, all reproducible by a command:

- a blue dot next to the job when the job description is ready
- a "Job Description" filter
- the save/evaluate button refuses jobs without text
- the X reappears in the SKIP tab; the Intern chip is gone (jobs remain)

Edit the files in `edits/`, never the files inside `career-ops/web/`. If apply
fails, upstream changed the snippet: nothing is written until all anchors
match.

## How it fits the architecture

It's the second consumer of the `01_jd-ready` index. Copies the index reader
into the Next app (Next's build can't reach folders outside `web/`). See
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md) §6 and §10.

## Last updated

2026-10-06

## Compatible with

career-ops v1.35.0 (web 0.13.0)

## How to use

```bash
npm run dashboard:check
npm run dashboard:apply
npm run dashboard:revert
```
