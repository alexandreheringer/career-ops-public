# 03_batch-anthropic

## Why it exists

Evaluating dozens of jobs one by one through Anthropic's synchronous API costs
twice as much. The batch (Message Batches) is cheaper — but only makes sense if
each job has real text. This module rejects what isn't `ready` in the index.

## What it does

Reads pending jobs, passes them through four filters (blocked company, safe
URL, job description ready, text with minimum length) and sends only the
approved ones. Then collects the responses and leaves a file ready for
career-ops to fold into the application tracker.

It doesn't fetch job descriptions. It doesn't generate PDFs. It doesn't check
if the job is still live. It only evaluates those that already have text on
disk.

## How it fits the architecture

It's the first consumer of the `01_jd-ready` contract. Reports go to the
career-ops user layer (`reports/`, `batch/`), which survives an update. See
[`Actual Architecture.md`](../../01-09%20System/01%20Architecture/Actual%20Architecture.md) §6.

## Last updated

2026-10-06

## Compatible with

career-ops v1.35.0

## How to use

```bash
npm run jd:gather -- --browser
npm run batch:submit:dry
npm run batch:submit -- --limit=10
npm run batch:collect
```
