#!/usr/bin/env node

/**
 * gather.mjs — coletar a job description que falta e marcar o contrato.
 *
 * Único escritor de `career-ops/jds/`. NÃO avalia nada: a saída dele é texto em
 * disco e uma linha no índice. Quem avalia (batch-anthropic, dashboard) só lê o
 * índice. Ver Actual Architecture.md §6.
 *
 * Uso:
 *   npm run jd:gather -- [--dry-run] [--limit=N] [--browser] [--company=sub] [--headful]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { JD_INDEX_PATH } from '../../career-ops-root.mjs';
import {
  JD_MIN_CHARS,
  markMissing,
  markReady,
  readIndex,
} from './jd-ready.mjs';
import {
  POLITENESS_DELAY_MS,
  formatJdFile,
  isLinkedIn,
  jdFileName,
  looksLikeLoginWall,
  sleep,
} from './jd-fetch.mjs';

/**
 * Validar o texto ANTES de gravar.
 *
 * `markReady` também checa 400 caracteres, mas lê o ARQUIVO — que carrega o
 * rodapé `Source:`. Um texto de 380 caracteres mais o rodapé passaria dos 400 e
 * viraria `ready` sem ter uma JD. O gate real é aqui, no texto puro; o do
 * `markReady` é a segunda trava.
 *
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function validateJdText(text) {
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, reason: 'sem texto' };
  if (body.length < JD_MIN_CHARS) {
    return {
      ok: false,
      reason: `texto curto (${body.length} caracteres, mínimo ${JD_MIN_CHARS})`,
    };
  }
  if (looksLikeLoginWall(body)) {
    return { ok: false, reason: 'parece muro de login, não job description' };
  }
  return { ok: true };
}

/**
 * Percorrer as vagas e preencher o contrato.
 *
 * `fetchJd` é injetado: no CLI é a cadeia de três estratégias, no teste é uma
 * função que devolve texto fixo. É o que permite testar toda a lógica de decisão
 * sem rede.
 *
 * @param {object} args
 * @param {Array<{url: string, company: string, role: string}>} args.offers
 * @param {string} args.indexPath
 * @param {string} args.careerOpsRoot - DATA root (de `getCareerOpsRoot()`).
 * @param {(url: string, offer: object) => Promise<{text: string|null, source: string|null, error: string|null}>} args.fetchJd
 * @param {boolean} [args.dryRun]
 * @param {number}  [args.limit]
 * @param {number}  [args.delayMs]
 * @param {(line: string) => void} [args.log]
 * @returns {Promise<{ready, missing, skipped, reindexed, wouldFetch, rows}>}
 */
export async function gatherOffers({
  offers,
  indexPath,
  careerOpsRoot,
  fetchJd,
  dryRun = false,
  limit,
  delayMs = POLITENESS_DELAY_MS,
  log = () => {},
}) {
  const list = limit === undefined ? offers : offers.slice(0, limit);
  const jdsDir = join(careerOpsRoot, 'jds');
  if (!dryRun) mkdirSync(jdsDir, { recursive: true });

  const index = readIndex(indexPath);
  const result = {
    ready: 0,
    missing: 0,
    skipped: 0,
    reindexed: 0,
    wouldFetch: 0,
    rows: [],
  };

  const record = (offer, status, reason, extra = {}) => {
    result.rows.push({
      url: offer.url,
      company: offer.company,
      role: offer.role,
      status,
      reason,
      ...extra,
    });
  };

  for (const offer of list) {
    const fileName = jdFileName(offer);
    const jdRel = `jds/${fileName}`;
    const abs = join(jdsDir, fileName);
    const label = `${offer.company || '?'} — ${(offer.role || '?').slice(0, 44)}`;

    // 1. já está ready e o arquivo está lá
    if (
      index.get(offer.url)?.status === 'ready' &&
      existsSync(join(careerOpsRoot, index.get(offer.url).jdPath))
    ) {
      result.skipped += 1;
      log(`  ${label} ... já ready`);
      record(offer, 'ready', 'já estava no índice');
      continue;
    }

    // 2. o arquivo esperado já existe — reindexa de graça, sem rede.
    //    É isto que faz apagar o jd-ready.tsv ser uma operação segura.
    if (existsSync(abs)) {
      const chars = readFileSync(abs, 'utf-8').trim().length;
      if (chars >= JD_MIN_CHARS) {
        if (!dryRun)
          markReady({ indexPath, careerOpsRoot, url: offer.url, jdRel });
        result.reindexed += 1;
        result.ready += 1;
        log(`  ${label} ... reindexado do disco (${chars} caracteres)`);
        record(offer, 'ready', 'arquivo já estava em jds/', { chars });
        continue;
      }
    }

    // 3. LinkedIn: muro de login. Não gasta requisição para confirmar o óbvio.
    if (isLinkedIn(offer.url)) {
      if (!dryRun)
        markMissing({
          indexPath,
          url: offer.url,
          reason: 'LinkedIn: muro de login',
        });
      result.missing += 1;
      log(`  ${label} ... missing (LinkedIn: muro de login)`);
      record(offer, 'missing', 'LinkedIn: muro de login');
      continue;
    }

    if (dryRun) {
      result.wouldFetch += 1;
      log(`  ${label} ... tentaria buscar`);
      record(offer, 'would-fetch', null);
      continue;
    }

    // 4. buscar — isolado: uma página que derruba o Chromium não pode abortar
    // as outras 388. Sem isto, gatherOffers não tem try e o .catch do main
    // imprime "gather falhou" e sai 1, com o índice pela metade.
    let text, source, error;
    try {
      ({ text, source, error } = await fetchJd(offer.url, offer));
    } catch (err) {
      text = null;
      source = null;
      error = err?.message || String(err);
    }
    await sleep(delayMs);

    // 5/6. validar e decidir
    const validation = text
      ? validateJdText(text)
      : { ok: false, reason: error || 'sem texto' };
    if (!validation.ok) {
      markMissing({ indexPath, url: offer.url, reason: validation.reason });
      result.missing += 1;
      log(`  ${label} ... missing (${validation.reason})`);
      record(offer, 'missing', validation.reason);
      continue;
    }

    writeFileSync(abs, formatJdFile({ text, url: offer.url }), 'utf-8');
    const marked = markReady({
      indexPath,
      careerOpsRoot,
      url: offer.url,
      jdRel,
    });
    if (!marked.ok) {
      // markReady é a segunda trava. Se ela recusa depois de validateJdText
      // aprovar, há um bug — reportar em vez de deixar o índice mentir.
      result.missing += 1;
      log(`  ${label} ... missing (markReady recusou: ${marked.reason})`);
      record(offer, 'missing', `markReady recusou: ${marked.reason}`);
      continue;
    }
    result.ready += 1;
    log(
      `  ${label} ... ready (${marked.chars} caracteres via ${source}) → ${jdRel}`,
    );
    record(offer, 'ready', null, { chars: marked.chars, source });
  }

  return result;
}

// ── CLI ────────────────────────────────────────────────────────────────────

/**
 * A cadeia de verdade: API do ATS → HTTP → navegador.
 *
 * Para na primeira estratégia cujo texto passa `validateJdText`. Uma estratégia
 * que devolve um shell de SPA de 600 caracteres não "acertou" — ela gastaria a
 * vaga, então a validação roda aqui dentro e não só depois.
 */
function buildFetchChain({ browserFetcher, deps }) {
  return async (url) => {
    const attempts = [];

    for (const strategy of [
      () => deps.fetchViaAtsApi(url),
      () =>
        deps.fetchViaHttp(url, {
          userAgent: deps.userAgent,
          rejectPrivateOrInvalid: deps.rejectPrivateOrInvalid,
        }),
      browserFetcher
        ? () =>
            browserFetcher.fetch(url, {
              rejectPrivateOrInvalid: deps.rejectPrivateOrInvalid,
            })
        : null,
    ]) {
      if (!strategy) continue;
      const out = await strategy();
      if (out.text && validateJdText(out.text).ok) return out;
      attempts.push(
        out.error || (out.text ? validateJdText(out.text).reason : 'sem texto'),
      );
    }

    return { text: null, source: null, error: attempts.join(' · ') };
  };
}

async function main(argv) {
  const has = (f) => argv.includes(f);
  const value = (f) =>
    argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);

  const unknown = argv.filter(
    (a) => !/^--(dry-run|browser|headful|help)$|^--(limit|company)=/.test(a),
  );
  if (unknown.length || has('--help')) {
    console.log(`Uso: npm run jd:gather -- [--dry-run] [--limit=N] [--browser] [--company=sub] [--headful]

  --dry-run        Relata o que faria. Não escreve em jds/ nem no índice. Sem rede.
  --limit=N        Só as N primeiras pendentes do pipeline.
  --browser        Habilita a 3ª estratégia (Playwright). Resolve os boards em JS.
  --company=sub    Só vagas cuja empresa contém esta substring.
  --headful        Com --browser, abre o navegador visível (para depurar seletor).`);
    if (unknown.length) {
      console.error(`\nFlag desconhecida: ${unknown.join(', ')}`);
      process.exit(1);
    }
    return;
  }

  const dryRun = has('--dry-run');
  const useBrowser = has('--browser');
  const companyFilter = (value('--company') || '').toLowerCase();
  const rawLimit = value('--limit');
  let limit;
  if (rawLimit !== undefined) {
    limit = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      console.error(
        `--limit espera um inteiro positivo, recebeu "${rawLimit}"`,
      );
      process.exit(1);
    }
  }

  // Importado aqui, não no topo: o career-ops resolve data root e tenta carregar
  // dotenv no import, e um --help não deveria precisar de nada disso.
  const { getCareerOpsRoot } =
    await import('../../career-ops/path-resolver.mjs');
  const { rejectPrivateOrInvalid } =
    await import('../../career-ops/liveness-browser.mjs');
  const { BROWSER_LIKE_USER_AGENT } =
    await import('../../career-ops/user-agent.mjs');
  const {
    PIPELINE_CHECKBOX_RE,
    extractPipelineUrl,
    extractPipelineCompanyRole,
  } = await import('./pipeline-entry.mjs');
  const { fetchViaAtsApi, fetchViaHttp, createBrowserFetcher } =
    await import('./jd-fetch.mjs');

  const careerOpsRoot = getCareerOpsRoot();
  const pipelinePath = join(careerOpsRoot, 'data', 'pipeline.md');

  console.log('=== jd-ready · gather ===');
  console.log(`Pipeline: ${pipelinePath}`);
  console.log(`Índice:   ${relative(process.cwd(), JD_INDEX_PATH)}`);
  console.log(
    `Estratégias: ats-api, http${useBrowser ? ', browser' : ''}${dryRun ? '  (dry run — nada é escrito)' : ''}`,
  );

  if (!existsSync(pipelinePath)) {
    console.log(`\nPipeline não encontrado. Nada a fazer.`);
    return;
  }

  // Só as linhas pendentes. `- [x]` já foi processada, `- [!]` não é vaga vista.
  const offers = [];
  for (const raw of readFileSync(pipelinePath, 'utf-8').split(/\r?\n/)) {
    if (!PIPELINE_CHECKBOX_RE.test(raw)) continue;
    if (/^\s*- \[x\]/i.test(raw)) continue;
    const url = extractPipelineUrl(raw);
    if (!url) continue;
    const pair = extractPipelineCompanyRole(raw) || {};
    const company = (pair.company || '').trim();
    if (companyFilter && !company.toLowerCase().includes(companyFilter))
      continue;
    offers.push({ url, company, role: (pair.role || '').trim() });
  }

  console.log(
    `\n${offers.length} vaga(s) pendente(s)${companyFilter ? ` com empresa contendo "${companyFilter}"` : ''}.\n`,
  );
  if (offers.length === 0) return;

  const browserFetcher =
    !dryRun && useBrowser
      ? await createBrowserFetcher({ headful: has('--headful') })
      : null;

  try {
    const result = await gatherOffers({
      offers,
      indexPath: JD_INDEX_PATH,
      careerOpsRoot,
      limit,
      dryRun,
      log: (line) => console.log(line),
      fetchJd: dryRun
        ? async () => ({ text: null, source: null, error: 'dry-run' })
        : buildFetchChain({
            browserFetcher,
            deps: {
              fetchViaAtsApi,
              fetchViaHttp,
              rejectPrivateOrInvalid,
              userAgent: BROWSER_LIKE_USER_AGENT,
            },
          }),
    });

    console.log('\n--- resumo ---');
    if (dryRun) {
      console.log(`  já ready:        ${result.skipped}`);
      console.log(`  reindexaria:     ${result.reindexed}`);
      console.log(`  tentaria buscar: ${result.wouldFetch}`);
      console.log(`  missing certo:   ${result.missing}  (LinkedIn)`);
      console.log('\nNada foi escrito. Tire o --dry-run para valer.');
      if (!useBrowser)
        console.log(
          'Acrescente --browser para cobrir os boards em JavaScript.',
        );
    } else {
      console.log(
        `  ready:       ${result.ready}  (${result.reindexed} reindexados do disco)`,
      );
      console.log(`  missing:     ${result.missing}`);
      console.log(`  já estavam:  ${result.skipped}`);
      const reasons = new Map();
      for (const row of result.rows.filter((r) => r.status === 'missing')) {
        reasons.set(row.reason, (reasons.get(row.reason) || 0) + 1);
      }
      if (reasons.size) {
        console.log('\n  motivos de missing:');
        for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${String(n).padStart(4)}  ${reason}`);
        }
      }
      console.log('\nPróximo: npm run batch:submit:dry');
    }
  } finally {
    await browserFetcher?.close();
  }
}

function invokedAsGatherCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return /(^|[\\/])gather\.mjs$/.test(entry);
}

if (invokedAsGatherCli()) {
  const { isMainModule } =
    await import('../../career-ops/lib/is-main-module.mjs');
  if (isMainModule(import.meta.url)) {
    main(process.argv.slice(2)).catch((err) => {
      console.error(`\ngather falhou: ${err?.message || err}`);
      process.exit(1);
    });
  }
}
