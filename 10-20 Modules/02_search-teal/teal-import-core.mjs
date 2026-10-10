/**
 * teal-import-core.mjs — Import Teal CSV exports into data/pipeline.md.
 *
 * Teal (https://tealhq.com) is a browser extension that saves job postings to a
 * personal tracker. Its CSV export is the fastest way to get a curated shortlist
 * into career-ops: paste-one-URL-at-a-time does not scale past a handful.
 *
 * ── Why this delegates almost everything ─────────────────────────────────
 *
 * An importer writing `data/pipeline.md` by hand gets four things wrong, and
 * every one of them fails silently:
 *
 *   1. The section marker. `scan.mjs` recognizes `## Pending` and `## Pendientes`
 *      only. Rows appended under any other heading are invisible to the scanner
 *      and to dedupe — they sit in the file looking fine and are never read.
 *   2. The lock. `data/pipeline.md` has 4+ concurrent writers (scan.mjs,
 *      rank-pipeline.mjs, the web dashboard, plugins). A plain writeFileSync
 *      races them.
 *   3. The column contract. Columns are positional (1/3/4/5 cells), and
 *      `web/src/lib/pipeline-table.mjs` drops any row with fewer than 3 — so a
 *      URL-only row works in the core and vanishes from the dashboard.
 *   4. Dedupe. The seen-set is the union of pipeline.md + applications.md +
 *      scan-history.tsv, keyed through `normalizeUrlForDedup`, not raw strings.
 *
 * So the only thing this module owns is *parsing Teal's CSV*. Formatting and
 * writing go through `formatPipelineOffer` / `appendToPipeline`, and dedupe
 * through `loadSeenUrls` — all from scan.mjs, all already correct.
 *
 * Reused by import-teal.mjs (CLI).
 */

import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  renameSync,
} from 'fs';
import { join } from 'path';

import {
  appendToPipeline,
  formatPipelineOffer,
  loadSeenUrls,
  loadBlacklist,
  findBlacklistEntry,
  normalizeUrlForDedup,
  PIPELINE_PATH,
  SCAN_HISTORY_PATH,
} from '../../career-ops/scan.mjs';
import { getCareerOpsRoot } from '../../career-ops/path-resolver.mjs';
import { SEARCH_TEAL_DIR } from '../../career-ops-root.mjs';
import { extractPipelineUrl } from '../01_jd-ready/pipeline-entry.mjs';
import {
  parseCsv,
  parseTealCsv,
  SKIP_STATUSES,
  markOffersMissing,
} from './teal-parse.mjs';

export { parseCsv, parseTealCsv, SKIP_STATUSES, markOffersMissing };

const DATA_ROOT = getCareerOpsRoot();

/**
 * Caixa de entrada do Teal. Fica NO PLUGIN, não dentro do career-ops.
 *
 * `career-ops/data/teal-imports/` funcionava e era camada do usuário, então
 * sobreviveria a um update. A mudança não é por segurança — é de legibilidade:
 * olhando a raiz do projeto você vê quais plugins existem e onde cada um guarda
 * sua entrada. Ver Actual Architecture.md §4.
 */
export const TEAL_DIR = join(SEARCH_TEAL_DIR, 'inbox');

/** CSV importado é MOVIDO para cá, nunca apagado — ver importTealCsvs. */
export const TEAL_PROCESSED_DIR = join(SEARCH_TEAL_DIR, 'processed');

const APPLICATIONS_PATH = join(DATA_ROOT, 'data', 'applications.md');

// ── Orchestration ───────────────────────────────────────────────────────

/**
 * Import every CSV in `dir` into the pipeline.
 *
 * Processed files are MOVED to `processed/`, never deleted: a Teal export is
 * often the only copy of a curated shortlist, and an import that half-succeeds
 * then unlinks its input is unrecoverable.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Parse and report; write and move nothing.
 * @param {string}  [options.dir] - Input directory (default: TEAL_DIR (`search-teal/inbox`)).
 * @param {number}  [options.limit] - Cap on offers added this run.
 * @returns {Promise<{added:number, skippedDuplicate:number, skippedBlacklist:number,
 *                    files:string[], offers:Array, blacklisted:Array,
 *                    markedMissing:number, capped:boolean}>}
 */
export async function importTealCsvs({
  dryRun = false,
  dir = TEAL_DIR,
  limit,
} = {}) {
  const empty = {
    added: 0,
    skippedDuplicate: 0,
    skippedBlacklist: 0,
    files: [],
    offers: [],
    blacklisted: [],
    markedMissing: 0,
    capped: false,
  };
  if (!existsSync(dir)) return empty;

  const csvFiles = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort();
  if (csvFiles.length === 0) return empty;

  // Dedupe against the same three sources the scanner uses, so a job already
  // tracked, already pending, or already seen by a scan is not re-added.
  // loadSeenUrls returns { seen, recheckEligible }; only the Set matters here.
  const { seen } = loadSeenUrls(
    {},
    {
      scanHistoryPath: SCAN_HISTORY_PATH,
      pipelinePath: PIPELINE_PATH,
      applicationsPath: APPLICATIONS_PATH,
    },
  );
  const blacklist = loadBlacklist();

  const newOffers = [];
  const blacklisted = [];
  let skippedDuplicate = 0;
  let capped = false;

  for (const file of csvFiles) {
    const text = readFileSync(join(dir, file), 'utf-8');
    for (const offer of parseTealCsv(text)) {
      const key = normalizeUrlForDedup(offer.url);
      if (seen.has(key)) {
        skippedDuplicate++;
        continue;
      }

      // The blacklist is a gate, not a signal: an importer that ignores it
      // quietly reintroduces every company the user told us to never show again.
      const hit = findBlacklistEntry(blacklist, offer.company, offer.url);
      if (hit) {
        blacklisted.push({ ...offer, reason: hit.reason || 'blacklisted' });
        seen.add(key);
        continue;
      }

      if (limit !== undefined && newOffers.length >= limit) {
        // Ainda há vaga elegível neste CSV. Mover o arquivo agora tira o
        // resto da inbox: a próxima rodada não acha CSV nenhum, e o que
        // sobrou fica em processed/ parecendo já importado.
        capped = true;
        continue;
      }
      seen.add(key);
      newOffers.push(offer);
    }
  }

  let markedMissing = 0;
  if (!dryRun) {
    // Marcar ANTES de appendToPipeline. A ordem inversa não tem retry: o
    // append entra no seen-set, o processo morre no meio do mark, e a rodada
    // seguinte classifica tudo como duplicata e não chama markOffersMissing.
    // Índice com linha sobrando e pipeline sem a vaga é o lado recuperável —
    // a próxima rodada adiciona e marca de novo, e markMissing é idempotente.
    markedMissing = markOffersMissing({
      offers: newOffers,
      toIndexUrl: (offer) =>
        extractPipelineUrl(formatPipelineOffer(offer)) || offer.url,
    });
    await appendToPipeline(newOffers);
    if (!capped) {
      mkdirSync(TEAL_PROCESSED_DIR, { recursive: true });
      for (const file of csvFiles) {
        renameSync(join(dir, file), join(TEAL_PROCESSED_DIR, file));
      }
    }
  }

  return {
    added: newOffers.length,
    skippedDuplicate,
    skippedBlacklist: blacklisted.length,
    files: csvFiles,
    offers: newOffers,
    blacklisted,
    markedMissing,
    capped,
  };
}

/** Render the pipeline lines an import WOULD write — used by --dry-run. */
export function previewLines(offers) {
  return offers.map((o) => formatPipelineOffer(o));
}
