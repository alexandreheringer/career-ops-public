/**
 * teal-parse.mjs — parse of a Teal CSV export, and marking those offers missing.
 *
 * GitHub Actions clones this git only. Tests load this file; they must not
 * pull in the gitignored checkout. Production wiring (formatPipelineOffer,
 * appendToPipeline) stays in teal-import-core.mjs.
 */

import { JD_INDEX_PATH } from '../../career-ops-root.mjs';
import { isReady, markMissing, readIndex } from '../01_jd-ready/jd-ready.mjs';

// ── CSV parsing (RFC-4180 state machine) ────────────────────────────────

/**
 * Parse CSV text into rows of cells.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded commas and newlines,
 * and CRLF. Teal quotes any role title containing a comma, which is most of
 * them, so a naive `split(',')` mangles the majority of a real export.
 *
 * @param {string} text - Raw CSV content.
 * @returns {string[][]} Rows of raw cell strings.
 */
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\r') {
        /* skip CR */
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        field = '';
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Teal `statusName` values that mean the posting is dead to the user.
 *
 * Case-insensitive. Matching fails OPEN on purpose: an unrecognized status is
 * imported rather than silently dropped, because Teal lets users rename their
 * own columns and a dropped job is invisible, while an extra one costs a glance.
 */
export const SKIP_STATUSES = new Set([
  'rejected',
  'not_interested',
  'not interested',
  'archived',
  'declined',
  'closed',
]);

/** Teal's `posted_at` is an ISO timestamp; formatPipelineOffer wants epoch ms. */
function postedAtToEpochMs(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Build the `salary` shape formatPipelineOffer/formatCompensation expect. */
function parseSalary(min, max, currency) {
  const num = (raw) => {
    const n = Number(String(raw ?? '').trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const lo = num(min);
  const hi = num(max);
  if (lo === undefined && hi === undefined) return undefined;
  return { min: lo, max: hi, currency: String(currency ?? '').trim() };
}

/**
 * Compose the labeled `note:` segment from Teal-only signals.
 *
 * modes/pipeline.md reserves `note:` for exactly this — "a free-text ranking
 * signal an importer attached to the offer" — and states the deterministic
 * scanner never writes it, so there is nothing to collide with.
 */
function buildNote(source, excitement) {
  const parts = [];
  const src = String(source ?? '').trim();
  const exc = String(excitement ?? '').trim();
  if (src) parts.push(`via ${src}`);
  if (exc && exc !== '0') parts.push(`excitement ${exc}`);
  parts.push('teal');
  return parts.join(', ');
}

/**
 * Parse one Teal CSV export into offer objects.
 *
 * Columns are resolved BY NAME from the header row, so Teal reordering or
 * adding columns cannot shift the data. Verified against a real export
 * (24 columns): company_name, location, role, url, excitement, source,
 * min_salary, max_salary, salary_currency, posted_at, archived_at, statusName.
 *
 * @param {string} text - Raw CSV content.
 * @returns {Array<{url,company,title,location,salary,postedAt,note}>}
 */
export function parseTealCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const at = (name) => header.indexOf(name);
  const col = {
    company: at('company_name'),
    location: at('location'),
    role: at('role'),
    url: at('url'),
    status: at('statusname'),
    archivedAt: at('archived_at'),
    minSalary: at('min_salary'),
    maxSalary: at('max_salary'),
    currency: at('salary_currency'),
    postedAt: at('posted_at'),
    excitement: at('excitement'),
    source: at('source'),
  };
  // Without a URL there is nothing to put in the pipeline.
  if (col.url === -1) return [];

  const cell = (cells, idx) =>
    idx === -1 ? '' : String(cells[idx] ?? '').trim();

  const offers = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const url = cell(cells, col.url);
    if (!/^https?:\/\//i.test(url)) continue;

    // Archived (structured timestamp signal) → skip.
    if (cell(cells, col.archivedAt)) continue;

    // Dead status (blocklist) → skip.
    if (SKIP_STATUSES.has(cell(cells, col.status).toLowerCase())) continue;

    offers.push({
      url,
      company: cell(cells, col.company) || 'Unknown',
      title: cell(cells, col.role).replace(/\s+/g, ' ').replace(/\.+$/, ''),
      location: cell(cells, col.location),
      salary: parseSalary(
        cell(cells, col.minSalary),
        cell(cells, col.maxSalary),
        cell(cells, col.currency),
      ),
      postedAt: postedAtToEpochMs(cell(cells, col.postedAt)),
      note: buildNote(cell(cells, col.source), cell(cells, col.excitement)),
    });
  }
  return offers;
}

/**
 * Marcar como `missing` no índice jd-ready toda vaga que este import adicionou.
 *
 * O CSV do Teal não tem coluna de descrição — 24 colunas verificadas, nenhuma
 * delas é a JD — e a maioria das URLs é LinkedIn, que pede login. Então a
 * verdade sobre uma vaga recém-importada é "está no pipeline, não tem JD, não
 * entra em avaliação". Dizer isso agora é melhor que deixar o gather descobrir:
 * o dashboard já mostra o círculo vazio na primeira renderização.
 *
 * URL que já está `ready` fica como está. Rebaixar apagaria o `jd_path` e
 * tiraria do lote uma vaga que já tem texto.
 *
 * Separado de `importTealCsvs` de propósito: aquele chama `appendToPipeline` e
 * escreve no checkout real, então não é testável sem efeito colateral. Este é.
 *
 * @param {{indexPath?: string, offers: Array<{url: string}>, toIndexUrl?: (offer: {url: string}) => string}} args
 * @returns {number} Quantas linhas foram marcadas.
 */
export function markOffersMissing({
  indexPath = JD_INDEX_PATH,
  offers,
  toIndexUrl = (offer) => offer.url,
}) {
  // Lido uma vez: `markMissing` regrava o arquivo inteiro a cada URL, mas a
  // decisão de não rebaixar `ready` é sobre o estado de ANTES desta chamada.
  // `markMissing` do plano 01 faz `index.set` incondicional — chamar nele uma
  // URL `ready` apaga o jd_path e tira a vaga do lote.
  const index = readIndex(indexPath);
  let marked = 0;
  for (const offer of offers) {
    // A chave do índice é a URL como ela aparece no pipeline.md, não a célula
    // crua do CSV. appendToPipeline grava sanitizePipelineUrl (privado do
    // scan.mjs): `|` vira %7C, `[` `]` `\\` são escapados. O gather e o
    // dashboard leem de volta via extractPipelineUrl. Indexar a URL crua deixa
    // a linha órfã na primeira vaga com `|` ou `[` no path.
    // Default toIndexUrl is identity so fixture LinkedIn URLs stay unsanitized
    // in tests; production passes the pipeline URL.
    const url = toIndexUrl(offer);
    if (isReady(index, url)) continue;
    const result = markMissing({
      indexPath,
      url,
      reason: 'Teal CSV não traz job description',
    });
    if (result.ok) marked += 1;
  }
  return marked;
}
