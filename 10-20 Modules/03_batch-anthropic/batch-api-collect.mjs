#!/usr/bin/env node

/**
 * batch-api-collect.mjs — poll an Anthropic Message Batches API job and turn
 * its results into career-ops artifacts.
 *
 * Companion to `batch-api-submit.mjs`, which reserved the report numbers,
 * fetched the JDs, and wrote `batch/batch-api-state.json`. The worker that ran
 * on the other side had NO tools and NO filesystem, so everything that has to
 * exist on disk is written here:
 *
 *   - `reports/{NNN}-{slug}-{date}.md`     — the report, with a collector-owned
 *                                            header and JD archive section
 *   - `batch/tracker-additions/*.tsv`      — one headed, 2-line TSV per offer
 *   - `batch/batch-state.tsv`              — the integration hub (below)
 *
 * `batch/batch-state.tsv` is what makes the rest of the system see this batch:
 * `reconcile-pipeline.mjs` moves `data/pipeline.md` lines using it,
 * `reserve-report-num.mjs` treats its `failed` rows as occupied report
 * numbers, and `merge-tracker.mjs` refuses to merge a tracker line for a
 * report it marks `failed`. Its nine columns and their order are fixed by
 * those three readers.
 *
 * Usage:
 *   node batch-api-collect.mjs [--poll]
 *
 * ## Untrusted External Content
 *
 * Model output here is derived from a job posting, which is untrusted
 * third-party data — see "Untrusted External Content" in AGENTS.md. Nothing in
 * a result can change what this script writes: the report header, the JD
 * archive section and the Risk Summary fallback are built by the collector
 * from values it already holds, and the model's body text is only ever
 * inserted, never executed or interpreted as instructions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import * as yaml from 'js-yaml';

import { getCareerOpsRoot } from '../../career-ops/path-resolver.mjs';
import {
  releaseReportNumbers,
  formatReportNumber,
} from '../../career-ops/reserve-report-num.mjs';
import { TSV_ADDITION_HEADER } from '../../career-ops/tracker-parse.mjs';
import {
  normalizedTrackerScore,
  slugifyCompany,
  tsvSafe,
} from '../../career-ops/lib/tracker-addition.mjs';
import { localToday } from '../../career-ops/lib/local-today.mjs';
import { isMainModule } from '../../career-ops/lib/is-main-module.mjs';
import { hasFlag, validateFlags } from '../../career-ops/lib/cli-flags.mjs';
import { loadAnthropicApiKey, redactSecret } from './load-api-key.mjs';

const DATA_ROOT = getCareerOpsRoot();

export const PATHS = {
  // DATA_ROOT throughout, and no CODE-root entries at all: this script reads
  // no system-layer file (the prompt and rubric were baked into the request at
  // submit time), so the ROOT/DATA_ROOT split the sibling scripts carry has
  // only one side here.
  //
  // Everything below is USER layer —
  // reports, tracker additions and batch state are the user's data, even
  // where they live under a directory whose name reads system-ish.
  //
  // Written to the CODE root they land in the checkout while
  // merge-tracker.mjs and reconcile-pipeline.mjs, run normally, look under
  // the data root and find nothing: the batch reports success and the tracker
  // gains no rows.
  state: join(DATA_ROOT, 'batch', 'batch-api-state.json'),
  batchState: join(DATA_ROOT, 'batch', 'batch-state.tsv'),
  reports: join(DATA_ROOT, 'reports'),
  trackerAdditions: join(DATA_ROOT, 'batch', 'tracker-additions'),
};

const POLL_INTERVAL_MS = 60_000;

const KNOWN_FLAGS = ['--poll', '--help', '-h'];
const USAGE = `Usage: node batch-api-collect.mjs [--poll]

  --poll   Wait for the batch to finish, checking every 60s, instead of
           reporting its status and exiting.`;

// batch-state.tsv's column contract, in order. Verified against the three
// readers: reconcile-pipeline.mjs destructures [, url, status, , , reportNum,
// score], reserve-report-num.mjs reads cols[2] (status) and cols[5]
// (report_num), and batch-runner.sh's init_state writes this exact header.
export const BATCH_STATE_COLUMNS = [
  'id',
  'url',
  'status',
  'started_at',
  'completed_at',
  'report_num',
  'score',
  'error',
  'retries',
];
export const BATCH_STATE_HEADER = BATCH_STATE_COLUMNS.join('\t');

const WORK_AUTH_LABELS = {
  sponsors: '✅ Sponsors',
  not_needed: '➖ Not needed',
  unstated: '⚠️ Unstated',
  no_sponsorship: '⛔ No sponsorship',
};

// ── Report parsing / normalization ─────────────────────────────────────────

/**
 * Pull the `## Machine Summary` YAML fence out of a worker response.
 *
 * @param {string} text - Raw model output.
 * @returns {object|null} Parsed mapping, or null when absent/unparseable.
 */
export function parseMachineSummary(text) {
  const raw = String(text);
  // Scoped by index rather than by one regex: a `(?=^##\s|$)` lookahead with
  // the `m` flag matches at the first line end, which truncates the section to
  // nothing, and JS has no `\z` anchor to reach for instead.
  const heading = raw.match(/^##\s+Machine Summary\b.*$/m);
  let scope = raw;
  if (heading) {
    const start = heading.index + heading[0].length;
    const rest = raw.slice(start);
    const next = rest.match(/^##\s+/m);
    scope = next ? rest.slice(0, next.index) : rest;
  }
  const fence = scope.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/);
  if (!fence) return null;
  try {
    const parsed = yaml.load(fence[1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Split a report body into `## ` sections, dropping the ones the collector
 * owns.
 *
 * The model's own header block (everything before the first `## `) is
 * discarded because the header is rebuilt here from values the collector
 * already holds — a model-written `**URL:**` or `**Score:**` can disagree with
 * the reserved number, the real URL, or the Machine Summary, and a header that
 * disagrees with its own report is worse than no header.
 *
 * A model-written `## Job Description` section is dropped too: the collector
 * appends the archived JD from its own copy, and two such sections would make
 * `check-jd-archive.mjs` credit whichever came first.
 *
 * @param {string} text - Raw model output.
 * @returns {{sections: Array<{heading: string, raw: string, body: string}>, headings: string[]}}
 *   `raw` is the heading line verbatim, so re-emitting a section preserves a
 *   translated heading exactly as the worker wrote it.
 */
export function splitReportSections(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: heading[1].trim(), raw: line, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);

  const kept = sections
    .filter((s) => !/^Machine Summary\b/i.test(s.heading))
    .filter((s) => !/^Job Description\b/i.test(s.heading))
    .map((s) => ({
      heading: s.heading,
      raw: s.raw,
      body: s.body.join('\n').trim(),
    }));

  return { sections: kept, headings: kept.map((s) => s.heading) };
}

/**
 * Which of blocks A-G are present?
 *
 * Headings are matched on the leading letter plus `)` — `## A) Role Summary`,
 * and its translated equivalents, which keep the `A)` marker per
 * batch/batch-prompt.md's "keep machine-readable field names exactly".
 *
 * @param {string[]} headings
 * @returns {string[]} The missing block letters, in order.
 */
export function missingBlocks(headings) {
  const present = new Set();
  for (const h of headings) {
    const m = h.match(/^([A-G])\s*[)\].:—–-]/);
    if (m) present.add(m[1].toUpperCase());
  }
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G'].filter(
    (letter) => !present.has(letter),
  );
}

function renderRiskSummary(summary) {
  const rows =
    summary && typeof summary.risk_summary === 'object' && summary.risk_summary
      ? summary.risk_summary
      : {};
  const order = [
    ['legitimacy', 'Posting legitimacy'],
    ['classification', 'Employment classification'],
    ['culture', 'Culture screen'],
    ['interview_redflags', 'Interview red flags'],
    ['ai_infra', 'AI buzzwords vs. infrastructure'],
    ['ai_screening_disclosure', 'AI-screening disclosure'],
  ];
  const lines = ['| Axis | Verdict |', '|------|---------|'];
  for (const [key, label] of order) {
    const value = rows[key];
    lines.push(`| ${label} | ${value ? String(value) : '— not evaluated'} |`);
  }
  lines.push('');
  lines.push(
    '_Synthesized by `batch-api-collect.mjs` from the Machine Summary `risk_summary` block: the worker did not emit a `## Risk Summary` section of its own._',
  );
  return lines.join('\n');
}

/**
 * Build the final report file content.
 *
 * Every field AGENTS.md and modes/oferta.md require is written here, from
 * collector-held values — not copied out of the model's text. The JD archive
 * section is appended from the submit-time capture, which is the only durable
 * record once the posting closes (#2789; `check-jd-archive.mjs` enforces it
 * inside `test-all.mjs`).
 *
 * @returns {{content: string, slug: string, score: number|null}}
 */
export function buildReport({
  offer,
  summary,
  body,
  headings,
  date,
  model,
  batchId,
  jdText,
}) {
  const company =
    String(summary?.company || offer.company || 'Unknown').trim() || 'Unknown';
  const role =
    String(summary?.role || offer.role || 'Unknown').trim() || 'Unknown';
  const archetype = String(summary?.archetype || '—').trim() || '—';
  const legitimacy = String(
    summary?.legitimacy_tier || 'Proceed with Caution',
  ).trim();
  const rawScore = summary?.score;
  const score = Number.isFinite(Number(rawScore)) ? Number(rawScore) : null;
  const workAuthKey = String(summary?.work_auth || 'unstated').trim();
  const workAuth = WORK_AUTH_LABELS[workAuthKey] || `⚠️ ${workAuthKey}`;
  const slug = slugifyCompany(company);

  const machineSummaryYaml = yaml
    .dump(summary ?? {}, { lineWidth: 100, noRefs: true })
    .trimEnd();

  const parts = [];
  parts.push(`# Evaluation: ${company} — ${role}`, '');
  // Field ORDER follows batch/batch-prompt.md's documented header, so the two
  // batch paths produce identically-shaped reports and `**URL:**` lands
  // between the score and the PDF line as AGENTS.md's pipeline-integrity rule
  // describes.
  parts.push(`**Date:** ${date}`);
  parts.push(`**Archetype:** ${archetype}`);
  parts.push(`**Score:** ${score === null ? 'N/A' : score}/5`);
  parts.push(`**Legitimacy:** ${legitimacy}`);
  parts.push(`**Work Auth:** ${workAuth}`);
  parts.push(`**URL:** ${offer.url}`);
  // No PDF on this path: a Batches API worker has no tools, so nothing could
  // have run generate-pdf.mjs. Said plainly rather than left blank.
  parts.push(
    `**PDF:** not generated — run \`/career-ops pdf ${slug}\` to create on demand`,
  );
  // AGENTS.md's headless-batch exception: liveness could not be confirmed
  // with Playwright, so the report says so instead of implying it was.
  parts.push('**Verification:** unconfirmed (batch mode)');
  parts.push(`**Tool:** Anthropic Message Batches API (${model})`);
  parts.push(`**Batch ID:** ${batchId}`);
  parts.push('', '---', '');
  parts.push(
    '## Machine Summary',
    '',
    '```yaml',
    machineSummaryYaml,
    '```',
    '',
  );

  parts.push(body.trim(), '');

  if (!headings.some((h) => /^Risk Summary\b/i.test(h))) {
    parts.push('## Risk Summary', '', renderRiskSummary(summary), '');
  }

  parts.push('---', '');
  parts.push('## Job Description (archived verbatim)', '');
  parts.push(
    String(jdText || '').trim() || '_No JD text was captured at submit time._',
    '',
  );

  return { content: parts.join('\n'), slug, score };
}

// ── batch-state.tsv ────────────────────────────────────────────────────────

function stateCell(value) {
  const text = String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
  return text === '' ? '-' : text;
}

/**
 * Upsert rows into `batch/batch-state.tsv`, keyed on the `id` column.
 *
 * Upsert rather than append, matching `batch-runner.sh`'s
 * `update_state_unlocked`: the file is a durable per-offer state record shared
 * with the shell runner, so re-running the collector must correct a row rather
 * than add a second one with the same id. Existing rows from other runs are
 * preserved verbatim — `reserve-report-num.mjs` reads this file to decide
 * which report numbers are taken, so dropping a historical `failed` row would
 * hand its number out again.
 *
 * @param {Array<object>} rows - Row objects keyed by BATCH_STATE_COLUMNS.
 * @param {string} [filePath]
 * @returns {{written: number, total: number}}
 */
export function writeBatchState(rows, filePath = PATHS.batchState) {
  const byId = new Map();
  const order = [];

  if (existsSync(filePath)) {
    for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('id\t')) continue;
      const id = line.split('\t')[0];
      if (!byId.has(id)) order.push(id);
      byId.set(id, line);
    }
  }

  for (const row of rows) {
    const cells = BATCH_STATE_COLUMNS.map((col) => stateCell(row[col]));
    const id = cells[0];
    if (!byId.has(id)) order.push(id);
    byId.set(id, cells.join('\t'));
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const out = [BATCH_STATE_HEADER, ...order.map((id) => byId.get(id))].join(
    '\n',
  );
  writeFileSync(filePath, `${out}\n`, 'utf-8');
  return { written: rows.length, total: order.length };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { requireOperand: true });
  const poll = hasFlag(args, '--poll');

  if (!existsSync(PATHS.state)) {
    console.error(`No batch state at ${PATHS.state}.`);
    console.error('Run `node batch-api-submit.mjs` first.');
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(PATHS.state, 'utf-8'));
  } catch (err) {
    console.error(`Could not parse ${PATHS.state}: ${err?.message || err}`);
    process.exit(1);
  }

  const {
    batch_id: batchId,
    offer_map: offerMap = {},
    model,
    date: submitDate,
  } = state;
  if (!batchId) {
    console.error(`${PATHS.state} has no batch_id — nothing to collect.`);
    process.exit(1);
  }

  console.log('=== career-ops · Message Batches API collect ===');
  console.log(`Batch ID:  ${batchId}`);
  console.log(`Submitted: ${state.submitted_at}`);
  console.log(`Requests:  ${state.total_requests}`);

  const { key: apiKey } = loadAnthropicApiKey();

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch (err) {
    console.error(
      `\n@anthropic-ai/sdk is not installed: ${err?.message || err}`,
    );
    console.error('Install it with:  npm install @anthropic-ai/sdk');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  async function status() {
    const batch = await client.messages.batches.retrieve(batchId);
    const c = batch.request_counts || {};
    console.log(`\nStatus: ${batch.processing_status}`);
    console.log(
      `  processing ${c.processing ?? '?'} · succeeded ${c.succeeded ?? '?'} · errored ${c.errored ?? '?'} · canceled ${c.canceled ?? '?'} · expired ${c.expired ?? '?'}`,
    );
    return batch;
  }

  let batch;
  try {
    batch = await status();
  } catch (err) {
    console.error(
      `\nCould not retrieve the batch: ${redactSecret(err?.message, apiKey)}`,
    );
    process.exit(1);
  }

  if (batch.processing_status !== 'ended') {
    if (!poll) {
      console.log('\nStill processing. Next steps:');
      console.log(
        '  node batch-api-collect.mjs --poll   # wait here until it finishes',
      );
      console.log(
        '  node batch-api-collect.mjs          # or check again later',
      );
      return;
    }
    console.log(
      `\nPolling every ${POLL_INTERVAL_MS / 1000}s until the batch ends...`,
    );
    while (batch.processing_status !== 'ended') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      batch = await status();
    }
  }

  console.log('\nBatch ended. Downloading results...');
  const results = [];
  for await (const result of await client.messages.batches.results(batchId)) {
    results.push(result);
  }
  console.log(`Downloaded ${results.length} result(s).`);

  mkdirSync(PATHS.reports, { recursive: true });
  mkdirSync(PATHS.trackerAdditions, { recursive: true });

  // LOCAL calendar day (#3070), not the UTC one. This value becomes three
  // things that must agree with each other and with the user's calendar: the
  // report FILENAME, the report's `**Date:**` header, and the tracker row's
  // date column. The filename is the part that cannot be corrected later,
  // because reports are addressed by it. The submit-time date is preferred
  // when present so a batch collected the next morning still files under the
  // day it was submitted.
  const date = submitDate || localToday();
  const nowIso = new Date().toISOString();

  const stateRows = [];
  const succeeded = [];
  const failed = [];

  for (const result of results) {
    const customId = result.custom_id;
    const offer = offerMap[customId];
    if (!offer) {
      console.warn(
        `  ⚠️  unknown custom_id ${customId} — not in the state file; skipping`,
      );
      continue;
    }
    const reportNum =
      offer.report_num_padded || formatReportNumber(offer.report_num);
    const label = `${offer.company || '?'} — ${(offer.role || '?').slice(0, 44)}`;

    const recordFailure = (reason) => {
      console.log(`  ❌ [${reportNum}] ${label}: ${reason}`);
      failed.push({ ...offer, reportNum, reason });
      stateRows.push({
        id: customId,
        url: offer.url,
        status: 'failed',
        started_at: state.submitted_at,
        completed_at: nowIso,
        // The number stays on the row on purpose: a `failed` row is how
        // reserve-report-num.mjs knows this number is spoken for, and how
        // merge-tracker.mjs knows to refuse a tracker line claiming it.
        report_num: reportNum,
        score: '-',
        error: reason,
        retries: 0,
      });
    };

    if (result.result?.type !== 'succeeded') {
      const detail =
        result.result?.error?.type ||
        result.result?.error?.message ||
        result.result?.type ||
        'unknown';
      recordFailure(
        `batch result ${result.result?.type || 'unknown'}: ${detail}`,
      );
      continue;
    }

    const text = (result.result.message?.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (!text.trim()) {
      recordFailure('worker returned no text content');
      continue;
    }
    if (result.result.message?.stop_reason === 'max_tokens') {
      recordFailure(
        'worker output was truncated at max_tokens — raise BATCH_MAX_TOKENS and resubmit',
      );
      continue;
    }
    if (result.result.message?.stop_reason === 'refusal') {
      recordFailure('worker refused the request (stop_reason: refusal)');
      continue;
    }

    const summary = parseMachineSummary(text);
    if (!summary) {
      recordFailure(
        'no parseable `## Machine Summary` YAML in the worker output',
      );
      continue;
    }

    const { sections, headings } = splitReportSections(text);
    const gaps = missingBlocks(headings);
    if (gaps.length > 0) {
      recordFailure(`worker output is missing block(s) ${gaps.join(', ')}`);
      continue;
    }

    const body = sections
      .map((s) => `${s.raw}\n\n${s.body}`.trimEnd())
      .join('\n\n');
    const { content, slug, score } = buildReport({
      offer,
      summary,
      body,
      headings,
      reportNum,
      date,
      model,
      batchId,
      jdText: offer.jd_text,
    });

    const filename = `${reportNum}-${slug}-${date}.md`;
    writeFileSync(join(PATHS.reports, filename), content, 'utf-8');

    // Tracker TSV: header row + exactly one data row. With the header,
    // merge-tracker.mjs resolves every field by NAME, so this row cannot be
    // ingested into the wrong columns (#3517) — the transposition bug the
    // headerless form has to guess its way around.
    const company = tsvSafe(summary.company || offer.company || 'Unknown');
    const role = tsvSafe(summary.role || offer.role || 'Unknown');
    const decision = tsvSafe(summary.final_decision || '');
    const note = tsvSafe(
      [
        decision ? decision.toUpperCase() : null,
        summary.legitimacy_tier || null,
        'batch API (unconfirmed liveness)',
      ]
        .filter(Boolean)
        .join(' | '),
    );

    const fields = {
      num: String(offer.report_num),
      date,
      company,
      role,
      status: 'Evaluated',
      score: normalizedTrackerScore(score ?? ''),
      pdf: '❌',
      // Root-relative, as the contract requires; merge-tracker.mjs rewrites it
      // relative to the tracker's own directory on merge.
      report: `[${reportNum}](reports/${filename})`,
      notes: note,
    };
    const row = TSV_ADDITION_HEADER.split('\t')
      .map((col) => fields[col] ?? '')
      .join('\t');
    writeFileSync(
      join(PATHS.trackerAdditions, `${reportNum}-${slug}.tsv`),
      `${TSV_ADDITION_HEADER}\n${row}\n`,
      'utf-8',
    );

    console.log(
      `  ✅ [${reportNum}] ${label} — ${score === null ? 'N/A' : score}/5`,
    );
    succeeded.push({
      reportNum,
      company,
      role,
      score,
      url: offer.url,
      decision,
    });
    stateRows.push({
      id: customId,
      url: offer.url,
      status: 'completed',
      started_at: state.submitted_at,
      completed_at: nowIso,
      report_num: reportNum,
      score: score === null ? '-' : String(score),
      error: '-',
      retries: 0,
    });
  }

  const { total } = writeBatchState(stateRows);
  console.log(
    `\nbatch-state.tsv: ${stateRows.length} row(s) upserted (${total} total).`,
  );

  // Hand the reservation sentinels back. `force: true` because the ownership
  // token reserveReportNumbers attaches is a Symbol on the returned array —
  // not JSON-serializable, so it did not survive the state file. Releasing is
  // safe for both outcomes: a succeeded number is now held by its report file
  // on disk, and a failed one by its `failed` row in batch-state.tsv, so
  // neither can be handed out again.
  const reserved = Array.isArray(state.reserved_report_numbers)
    ? state.reserved_report_numbers
    : [];
  if (reserved.length) {
    try {
      await releaseReportNumbers(reserved, { force: true });
    } catch (err) {
      console.warn(
        `⚠️  could not release report reservations: ${err?.message || err}`,
      );
      console.warn(
        '   They are harmless and are garbage-collected after 4h (`node reserve-report-num.mjs --gc`).',
      );
    }
  }

  // ── summary ──
  console.log('\n=== Results ===');
  console.log(`Succeeded: ${succeeded.length} · Failed: ${failed.length}`);

  if (succeeded.length) {
    const ranked = [...succeeded].sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1),
    );
    console.log('\nScore | Company                        | Role');
    console.log(
      '------+--------------------------------+------------------------------------------',
    );
    for (const s of ranked) {
      const score = s.score === null ? 'N/A ' : String(s.score).padEnd(4);
      console.log(
        `${score}  | ${(s.company || '').slice(0, 30).padEnd(30)} | ${(s.role || '').slice(0, 42)}`,
      );
    }
  }

  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed)
      console.log(`  - [${f.reportNum}] ${f.company || '?'}: ${f.reason}`);
  }

  console.log('\nNext steps:');
  console.log(
    `  1. node merge-tracker.mjs          # fold ${succeeded.length} addition(s) into the tracker`,
  );
  console.log(
    '  2. node reconcile-pipeline.mjs     # drain data/pipeline.md using batch-state.tsv',
  );
  console.log('  3. node verify-pipeline.mjs        # health check');
  const strong = succeeded.filter((s) => (s.score ?? 0) >= 4.0);
  if (strong.length) {
    console.log(
      `\n🎯 ${strong.length} offer(s) scored 4.0+. These reports carry **Verification:** unconfirmed (batch mode):`,
    );
    console.log(
      '   confirm the posting is still live before applying, then run the pdf mode for a tailored CV.',
    );
  }
  if (!succeeded.length && !failed.length) {
    console.log('\n(No results matched the state file — nothing was written.)');
  }
}

if (isMainModule(import.meta.url)) {
  // Lazily, and only as a CLI — see the same note in batch-api-submit.mjs: a
  // module-level dotenv load fires on mere import, including inside the test
  // suite, and leaks the ambient .env into every importer's process.env.
  try {
    const { config } = await import('dotenv');
    config();
  } catch {
    /* dotenv is optional */
  }

  main().catch((err) => {
    console.error(
      `\nbatch-api-collect failed: ${redactSecret(err?.message || err, process.env.ANTHROPIC_API_KEY)}`,
    );
    process.exit(1);
  });
}
