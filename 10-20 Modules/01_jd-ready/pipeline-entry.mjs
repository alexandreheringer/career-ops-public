/**
 * pipeline-entry.mjs — parse de uma linha de checkbox de career-ops/data/pipeline.md.
 *
 * Cópia dos helpers que o `career-ops/scan.mjs` mantém privados
 * (`extractPipelineUrl`, `extractPipelineCompanyRole`, `pipelineEntry`).
 * Mora na camada base (`jd-ready/`) porque gather, search-teal e batch-anthropic
 * todos precisam dela — uma cópia, não quatro.
 *
 * Nunca editar `scan.mjs` para exportá-los: um `update-system.mjs` desfaz isso.
 * Se o upstream passar a exportá-los, este arquivo vira um re-export de uma linha.
 */

/**
 * The leading checkbox marker of a `data/pipeline.md` entry.
 *
 * Only ` ` and `x` are recognized, matching the pre-existing gates: `- [!]`
 * marks a URL that could not be fetched, which is not evidence a posting was
 * surfaced.
 *
 * Anchored, because the URL it guards is then matched anywhere in the entry: a
 * hand-written note that happens to contain checkbox syntax mid-sentence and a
 * link would otherwise seed that link and silently bury a live posting. Leading
 * whitespace is tolerated so an indented entry still dedupes, as it did when the
 * URL had to sit immediately after the checkbox.
 */
export const PIPELINE_CHECKBOX_RE = /^\s*- \[[ x]\]\s+/;

/**
 * As `PIPELINE_CHECKBOX_RE`, but rejecting indentation.
 *
 * The company/role gate stays exactly as strict as the `^- \[` anchor it
 * replaces: widening it would seed *more* role keys, and one role key suppresses
 * every other posting that shares it.
 */
const PIPELINE_CHECKBOX_STRICT_RE = /^- \[[ x]\]\s+/;

/**
 * A labeled trailing segment of a pipeline entry, as written by the two writers
 * that emit one: `formatPipelineOffer` here (`posted:`, `trust:`, `note:`) and
 * `appendRankAnnotation` in `rank-pipeline.mjs` (`rank:`).
 *
 * Labeled segments are appended after the positional columns, so one slides into
 * the location column whenever an offer has neither a location nor a
 * compensation. Used only to reject such a cell as a location.
 *
 * The label set is an ALLOW-LIST, not the shape `\p{L}[\p{L}\p{N} _-]*:` it
 * replaces. "Any word followed by a colon" is not a property that separates
 * metadata from locations: a location is free text on the board's side, and
 * `Remote: EMEA` / `Remote: Southeast US` (live Neo4j postings) are ordinary
 * values of that field. Reading one as metadata drops it to the bare wildcard
 * key, which then suppresses every city-specific variant of the same role —
 * exactly the collapse `dedup_include_location` exists to prevent, reintroduced
 * through the parser instead of the key.
 *
 * Deliberately NOT in the list: `score:`. `rank-pipeline.mjs` uses that word
 * only inside the prompt it sends an LLM ("score: 0-5, where 5 is an excellent
 * match"); the segment it actually writes to pipeline.md is `rank: {n}/5 — …`.
 * Prompt text is not a serialization format. Extend this list only alongside a
 * writer that really emits the label.
 *
 * Case-insensitive because the shape it replaces was (`\p{L}` spans both cases)
 * and because the two directions are not symmetric: failing to recognize a real
 * segment invents a city for a role and lets it resurface, while a genuine
 * location beginning `Posted: ` / `Rank: ` does not occur.
 */
const PIPELINE_LABELED_SEGMENT_RE = /^(?:posted|trust|note|rank):\s/iu;

/**
 * The `~~…~~` wrapper an expired entry is written with.
 *
 * Matched only at the start of the entry body, never searched for line-wide.
 * `~` is a legal URL character and a documented `note:` column may carry its own
 * strikethrough, so treating `~` as a global signal both truncates real URLs and
 * strips live entries of their pair. Expiry is a property of the entry, so it is
 * read at the entry boundary.
 */
const PIPELINE_STRIKETHROUGH_RE = /^~~([\s\S]*?)~~/;

/**
 * A URL inside a pipeline entry.
 *
 * Terminates on whitespace and `|` only. `|` cannot appear unencoded in a URL
 * and is this format's cell separator, so it is the one safe boundary; every
 * other character stays legal. `~` (RFC 3986 unreserved) and `)` (a sub-delim)
 * in particular must not terminate the match — excluding them truncated `~user`
 * paths and parenthesised region suffixes, and a truncated URL both stops
 * deduping and seeds a bare-origin key that everything else on that host then
 * false-matches against.
 *
 * `local:` entries are deliberately not matched — the gates this feeds have
 * always been http(s)-only.
 */
const PIPELINE_URL_RE = /https?:\/\/[^\s|]+/;

/**
 * Split a `data/pipeline.md` checkbox line into its entry body and expiry state.
 *
 * The body is whatever follows the checkbox, unwrapped when the entry is struck
 * out, so every caller parses the same cell sequence either way. An unclosed
 * wrapper still reads as expired: the opening `~~` is the marker.
 *
 * @param {string} line - One raw line of `data/pipeline.md`.
 * @param {RegExp} checkboxRe - Which checkbox anchor this gate accepts.
 * @returns {{body: string, expired: boolean}|null} Null when the line is not an
 *   entry at all.
 */
function pipelineEntry(line, checkboxRe) {
  const checkbox = line.match(checkboxRe);
  if (!checkbox) return null;

  const rest = line.slice(checkbox[0].length);
  if (!rest.startsWith('~~')) return { body: rest, expired: false };

  const closed = rest.match(PIPELINE_STRIKETHROUGH_RE);
  return { body: closed ? closed[1] : rest.slice(2), expired: true };
}

/**
 * Extract the job URL from a `data/pipeline.md` checkbox line, wherever it sits.
 *
 * Six line shapes are documented across the modes, and only the one
 * `appendToPipeline` writes leads with the URL. The others lead with a report
 * number (`#NNN`, `modes/pipeline.md`), a report link
 * (`[NNN](reports/…)`, `reconcile-pipeline.mjs`), a pre-screen marker (`#--`,
 * `modes/pipeline.md`), or a strikethrough (`~~…~~`, `modes/pipeline.md` and
 * `modes/oferta.md`). Anchoring the URL to the checkbox missed all five.
 *
 * An expired entry still seeds a URL key; only its company/role pair is withheld
 * (see `extractPipelineCompanyRole`).
 *
 * @param {string} line - One raw line of `data/pipeline.md`.
 * @returns {string|null} The URL, or null when the line carries none.
 */
export function extractPipelineUrl(line) {
  const entry = pipelineEntry(line, PIPELINE_CHECKBOX_RE);
  if (!entry) return null;

  const match = entry.body.match(PIPELINE_URL_RE);
  return match ? match[0] : null;
}

/**
 * Extract the company/role pair from a `data/pipeline.md` checkbox line.
 *
 * Company and role are the two cells *after* the URL cell, not cells 1 and 2 —
 * see `extractPipelineUrl` for why the URL is not always first.
 *
 * Two shapes deliberately yield nothing, mirroring the `status !== 'added'`
 * rule the scan-history branch of `collectSeenCompanyRoles` already applies:
 *
 * - **Expired entries** (`~~…~~`). Strikethrough is how the pipeline records the
 *   same state scan-history records as `skipped_expired`; seeding a dead
 *   posting's role key would let a dead SF URL bury a live NY req. Read at the
 *   entry boundary, so a `note:` column containing its own strikethrough leaves
 *   a live entry's pair intact.
 * - **Pre-screen discards** (`#-- | {url} | skipped (…)`). The cell after the
 *   URL is a discard reason, not a company.
 *
 * The third cell after the URL is reported as `location` only where it really is
 * one, because that column is positional and means different things per shape:
 *
 * - Only in the URL-first shape (`urlIndex === 0`) — the one `appendToPipeline`
 *   writes — is it the location. A report-led processed entry (`#143 | {url} |
 *   … | 4.2/5 | PDF ✅`) puts the SCORE in that position, and keying on it would
 *   invent a city for an already-processed role.
 * - A labeled segment (`posted:` / `trust:` / `note:` / `rank:`) slides into that
 *   position when the offer carried no location and no compensation, so it is
 *   skipped too. Only those four labels count — see
 *   {@link PIPELINE_LABELED_SEGMENT_RE} for why a bare `word:` prefix does not.
 *
 * Both fall back to `''` (location unknown), which `companyRoleDedupKey` reads as
 * "matches every city" — the conservative direction.
 *
 * @param {string} line - One raw line of `data/pipeline.md`.
 * @returns {{company: string, role: string, location: string}|null} The pair plus
 *   its location (`''` when unknown), or null when the line has none to contribute.
 */
export function extractPipelineCompanyRole(line) {
  const entry = pipelineEntry(line, PIPELINE_CHECKBOX_STRICT_RE);
  if (!entry || entry.expired) return null;

  const cells = entry.body.split('|').map((cell) => cell.trim());
  if (cells[0].startsWith('#--')) return null;

  const urlIndex = cells.findIndex((cell) => PIPELINE_URL_RE.test(cell));
  if (urlIndex === -1) return null;

  const [company = '', role = '', third = ''] = cells.slice(urlIndex + 1);
  const location =
    urlIndex === 0 && !PIPELINE_LABELED_SEGMENT_RE.test(third) ? third : '';
  return { company, role, location, url: cells[urlIndex] };
}
