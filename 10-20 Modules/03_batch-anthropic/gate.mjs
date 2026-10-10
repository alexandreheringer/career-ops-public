import {
  PIPELINE_CHECKBOX_RE,
  extractPipelineUrl,
  extractPipelineCompanyRole,
} from '../01_jd-ready/pipeline-entry.mjs';
import { jdPathFor } from '../01_jd-ready/jd-ready.mjs';

/** A `local:jds/{file}` pipeline reference. */
const LOCAL_REF_RE = /local:[^\s|]+/;

/**
 * Stand-in http URL used only while the shared extractors parse a `local:`
 * entry. `.invalid` is reserved by RFC 2606 and never resolves, so this can
 * never leak into a fetch even if a future edit forgets to swap it back.
 */
const LOCAL_SENTINEL_URL = 'https://local-jd.invalid/capture';

/**
 * Read the unchecked entries of `data/pipeline.md`.
 *
 * Parsing goes through the shared pipeline extractors rather than a local
 * regex. A private 3-column pattern (`- [ ] url | company | role`) silently
 * drops every other shape the pipeline legitimately carries — a bare URL, a
 * URL with a location column, a `posted:`/`trust:`/`note:`/`rank:` labelled
 * segment — and a dropped entry looks exactly like an empty pipeline.
 *
 * `local:jds/{file}` needs one accommodation. It is a first-class pipeline
 * reference, but the shared URL extractor matches `http(s)` only, so it finds
 * no URL cell on such a line and contributes nothing. Rather than hand-roll a
 * second column parser — which is exactly how the non-3-column shapes get lost
 * — the `local:` token is swapped for a sentinel http URL, the shared
 * extractors run on the rewritten line, and the original reference is restored
 * afterwards. One parser, both reference forms.
 *
 * @param {string} pipelineText - Raw `data/pipeline.md` contents.
 * @returns {Array<{url: string, company: string, role: string, line: string}>}
 */
export function readPendingOffers(pipelineText) {
  const offers = [];
  for (const raw of String(pipelineText).split(/\r?\n/)) {
    if (!PIPELINE_CHECKBOX_RE.test(raw)) continue;
    if (/^\s*- \[x\]/i.test(raw)) continue; // already processed

    const localRef = extractPipelineUrl(raw)
      ? null
      : (raw.match(LOCAL_REF_RE)?.[0] ?? null);
    const line = localRef ? raw.replace(localRef, LOCAL_SENTINEL_URL) : raw;

    const url = extractPipelineUrl(line);
    if (!url) continue;
    const pair = extractPipelineCompanyRole(line) || {};
    offers.push({
      url: localRef || url,
      company: (pair.company || '').trim(),
      role: (pair.role || '').trim(),
      line: raw,
    });
  }
  return offers;
}

// ── Gates ──────────────────────────────────────────────────────────────────

/**
 * Decidir quais vagas pendentes podem ir para o lote.
 *
 * Três gates, nesta ordem, e a ordem é a prioridade de diagnóstico: a resposta
 * mais específica sobre por que uma vaga não entrou é a que o usuário lê.
 *
 *   1. blacklist      — você disse para nunca mostrar esta empresa
 *   2. SSRF           — a URL não é um endereço público buscável
 *   3. jd-ready       — não existe job description para esta URL
 *
 * ## Por que o gate 3 existe, se o submit já valida a JD depois
 *
 * O submit tem uma segunda trava: ele busca a JD, mede, e descarta texto curto
 * ou muro de login. Essa trava continua. Mas ela não basta, por duas razões:
 *
 * - **Concordância.** O dashboard mostra tick azul lendo o índice. Se o lote
 *   avaliasse uma URL `missing` porque um fetch da hora achou texto, a tela e o
 *   lote discordariam sobre o que vai ser avaliado — e você não teria como saber
 *   qual dos dois está certo.
 * - **Custo.** Sem este gate, 77 URLs do LinkedIn pagam um fetch cada para serem
 *   descartadas, toda rodada.
 *
 * `jdRel` sai daqui preenchido para que a aquisição de JD leia o arquivo que o
 * gather já gravou em vez de buscar de novo.
 *
 * ## Por que `local:` passa direto
 *
 * Uma entrada `local:jds/x.md` JÁ é a captura. Exigir linha no índice para ela
 * seria exigir que o gather processasse uma vaga que nunca teve URL remota.
 * `resolveLocalJdPath` contém o caminho, e a validação de 400 caracteres roda
 * na aquisição como para todas as outras.
 *
 * Dependências injetadas (`findBlacklist`, `rejectUrl`) porque este laço é a
 * única parte do submit com decisões de negócio, e decisão de negócio se testa.
 *
 * ## Por que o `limit` entra aqui e não em `main()`
 *
 * Porque cortar antes dos gates não controla custo — controla sorte. As 77
 * primeiras pendentes são todas do LinkedIn, que nunca ficam `ready`, então um
 * `--limit=3` aplicado à lista crua devolve zero elegíveis. Depois dos gates,
 * `--limit=3` quer dizer três vagas avaliáveis. E, estando aqui, isso é um teste
 * em vez de um comentário.
 *
 * `gatedCount` sai separado de `candidates.length` porque quem foi cortado pelo
 * limite não foi *recusado*: entra na próxima rodada. Misturar os dois no
 * relatório de skipped diria que a vaga tem problema, e ela não tem.
 *
 * @param {object} args
 * @param {Array<{url: string, company: string, role: string}>} args.offers
 * @param {Map} args.jdIndex - De `readIndex(JD_INDEX_PATH)`.
 * @param {Array} args.blacklist
 * @param {(blacklist: Array, company: string, url: string) => ({company: string, reason?: string}|null)} args.findBlacklist
 * @param {(url: string) => ({reason: string}|null)} args.rejectUrl
 * @param {number} [args.limit=Infinity] - Quantas aprovadas levar, no máximo.
 * @returns {{candidates: Array, skipped: Array, gatedCount: number}}
 */
export function gateOffers({
  offers,
  jdIndex,
  blacklist,
  findBlacklist,
  rejectUrl,
  limit = Infinity,
}) {
  const approved = [];
  const skipped = [];

  for (const offer of offers) {
    const bl = findBlacklist(blacklist, offer.company, offer.url);
    if (bl) {
      skipped.push({
        ...offer,
        reason: `blacklisted (${bl.company}): ${bl.reason || 'no reason recorded'}`,
      });
      continue;
    }

    if (offer.url.startsWith('local:')) {
      approved.push(offer);
      continue;
    }

    const rejected = rejectUrl(offer.url);
    if (rejected) {
      skipped.push({ ...offer, reason: `blocked URL: ${rejected.reason}` });
      continue;
    }

    const jdRel = jdPathFor(jdIndex, offer.url);
    if (!jdRel) {
      skipped.push({
        ...offer,
        reason:
          'sem job description (jd-ready) — rode: npm run jd:gather -- --browser',
      });
      continue;
    }

    approved.push({ ...offer, jdRel });
  }

  const candidates = limit === Infinity ? approved : approved.slice(0, limit);
  return { candidates, skipped, gatedCount: approved.length };
}
