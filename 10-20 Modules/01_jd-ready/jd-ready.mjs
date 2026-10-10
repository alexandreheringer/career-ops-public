/**
 * jd-ready.mjs — o índice "esta URL tem job description?".
 *
 * É a única fonte de verdade sobre o que pode ser avaliado. O lote da Anthropic
 * e o dashboard leem daqui; `gather.mjs` e `search-teal` escrevem. Ver
 * Actual Architecture.md §5 para o formato e §6 para onde cada gate fica.
 *
 * Sem rede. Sem importar career-ops. Sem dependência de npm. Um consumidor que
 * só quer saber "posso avaliar esta URL?" paga um readFileSync.
 *
 * O TSV é DESCARTÁVEL: apagá-lo não perde o texto das vagas, que mora em
 * `career-ops/jds/`. Um `npm run jd:gather` reconstrói o índice.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Piso de caracteres para um texto contar como job description.
 *
 * 400 é o mesmo valor que `career-ops` já aplica no batch (`JD_MIN_CHARS` em
 * batch-api-submit.mjs) e que o projeto anterior aplicava em jd-fetch-core.mjs.
 * Um número, um lugar. Mudá-lo aqui muda o gate de todo o sistema.
 */
export const JD_MIN_CHARS = 400;

/** As colunas, em ordem. Acrescentar uma é editar esta linha e `rowToTsv`. */
export const INDEX_COLUMNS = ['url', 'status', 'jd_path', 'chars', 'updated'];
export const INDEX_HEADER = INDEX_COLUMNS.join('\t');

/**
 * Data civil LOCAL, não UTC.
 *
 * Uma rodada de domingo à noite nas Américas registraria amanhã se usasse
 * `toISOString()`. A coluna serve para humano ler, então é o dia do humano.
 */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Ler o índice.
 *
 * Arquivo ausente devolve índice vazio — "ninguém coletou nada ainda" é um
 * estado normal, não um erro. Linha malformada é pulada: com status vazio ela
 * não é `ready`, que é a direção conservadora.
 *
 * @param {string} indexPath
 * @returns {Map<string, {url: string, status: string, jdPath: string, chars: number, updated: string}>}
 */
export function readIndex(indexPath) {
  const index = new Map();
  let text;
  try {
    text = readFileSync(indexPath, 'utf-8');
  } catch {
    return index;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('url\t')) continue; // cabeçalho
    const [url = '', status = '', jdPath = '', chars = '', updated = ''] =
      line.split('\t');
    if (!url) continue;
    index.set(url, {
      url,
      status: status.trim(),
      jdPath: jdPath.trim(),
      chars: Number.parseInt(chars, 10) || 0,
      updated: updated.trim(),
    });
  }
  return index;
}

/**
 * Esta URL pode ser avaliada?
 *
 * @param {Map} index - Resultado de `readIndex`.
 * @param {string} url - A URL exata como está no pipeline.md.
 * @returns {boolean}
 */
export function isReady(index, url) {
  return index.get(url)?.status === 'ready';
}

/**
 * O caminho do arquivo de JD desta URL, relativo ao DATA root do career-ops.
 *
 * Existe para que o consumidor LEIA o texto que já foi coletado em vez de
 * refazer o fetch. É o que faz o lote não pagar rede duas vezes pela mesma vaga.
 *
 * @returns {string|null} ex. `jds/acme-data-engineer.md`, ou null se não está ready.
 */
export function jdPathFor(index, url) {
  const row = index.get(url);
  return row?.status === 'ready' && row.jdPath ? row.jdPath : null;
}

/** Contagem por status — usado pelos relatórios de dry-run. */
export function countByStatus(index) {
  let ready = 0;
  let missing = 0;
  for (const row of index.values()) {
    if (row.status === 'ready') ready += 1;
    else missing += 1;
  }
  return { ready, missing };
}

// ── Escrita ────────────────────────────────────────────────────────────────

/**
 * Resolver `jdRel` para um caminho absoluto DENTRO de `{careerOpsRoot}/jds`.
 *
 * `jdRel` é montado a partir de nome de empresa e cargo lidos de uma página de
 * terceiro. Um `../../.ssh/id_rsa` precisa ser recusado aqui, não auditado
 * depois — é a mesma contenção que `resolveLocalJdPath` faz no
 * `batch-api-submit.mjs` do career-ops, pelo mesmo motivo.
 *
 * Aceita `jds/acme.md` e `acme.md`; os dois resolvem para o mesmo lugar.
 *
 * @param {string} careerOpsRoot - DATA root do career-ops (de `getCareerOpsRoot()`).
 * @param {string} jdRel
 * @returns {string|null} Absoluto, ou null quando escapa.
 */
export function resolveJdPath(careerOpsRoot, jdRel) {
  const rel = String(jdRel ?? '').trim();
  if (!rel || isAbsolute(rel)) return null;
  const jdsDir = resolve(careerOpsRoot, 'jds');
  const abs = resolve(jdsDir, rel.replace(/^jds\//, ''));
  const within = relative(jdsDir, abs);
  if (!within || within.startsWith('..') || isAbsolute(within)) return null;
  return abs;
}

/** Nenhum valor com tab ou newline entra num TSV. */
function tsvSafe(value) {
  const v = String(value ?? '').trim();
  if (!v || /[\t\r\n]/.test(v)) return null;
  return v;
}

function rowToTsv(row) {
  return [
    row.url,
    row.status,
    row.jdPath || '',
    String(row.chars ?? 0),
    row.updated || '',
  ].join('\t');
}

/**
 * Gravar o índice inteiro, ordenado por URL.
 *
 * Reescrita completa, não append: a chave é a URL e uma segunda linha para a
 * mesma URL é ambígua. Ordenado para que um `git diff` (se alguém algum dia
 * versionar isto) mostre a linha que mudou e não um reembaralhamento.
 *
 * Escrita atômica via tmp + rename: uma interrupção no meio deixa o arquivo
 * anterior intacto em vez de um TSV truncado, que o `readIndex` leria como
 * "metade das vagas nunca foi coletada".
 */
function writeIndex(indexPath, index) {
  const rows = [...index.values()]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map(rowToTsv);
  mkdirSync(dirname(indexPath), { recursive: true });
  const tmpPath = `${indexPath}.tmp`;
  writeFileSync(
    tmpPath,
    `${INDEX_HEADER}\n${rows.map((r) => `${r}\n`).join('')}`,
    'utf-8',
  );
  renameSync(tmpPath, indexPath);
}

/**
 * Marcar uma URL como pronta para avaliação.
 *
 * Recusa — e NÃO escreve nada — quando o caminho escapa de `jds/`, o arquivo
 * não existe, ou o texto tem menos de `JD_MIN_CHARS`. Essas três são a mesma
 * regra: `ready` significa "tem texto de JD de verdade neste arquivo".
 *
 * @param {{indexPath: string, careerOpsRoot: string, url: string, jdRel: string}} args
 * @returns {{ok: true, chars: number}|{ok: false, reason: string}}
 */
export function markReady({ indexPath, careerOpsRoot, url, jdRel }) {
  const key = tsvSafe(url);
  if (!key) return { ok: false, reason: 'URL vazia ou com tab/newline' };

  const abs = resolveJdPath(careerOpsRoot, jdRel);
  if (!abs)
    return {
      ok: false,
      reason: `jd_path escapa de jds/: ${JSON.stringify(jdRel)}`,
    };

  // Leitura dentro de try: readFileSync lança EISDIR se `jds/x.md`
  // for um diretório, e EACCES/ENOENT se o arquivo sumir entre as duas. O
  // gather chama isto num laço de centenas de URLs — uma exceção mata a rodada
  // inteira em vez de marcar uma vaga como missing.
  let chars;
  try {
    chars = readFileSync(abs, 'utf-8').trim().length;
  } catch (err) {
    // MUST include "não existe" for ENOENT so the test matches /não existe/
    if (err && err.code === 'ENOENT') {
      return { ok: false, reason: `não existe ${jdRel}` };
    }
    return {
      ok: false,
      reason: `não deu para ler ${jdRel}: ${err.code || err.message}`,
    };
  }
  if (chars < JD_MIN_CHARS) {
    return {
      ok: false,
      reason: `texto curto (${chars} caracteres, mínimo ${JD_MIN_CHARS})`,
    };
  }

  // Normalizado a partir do caminho resolvido, não do que o chamador passou:
  // `acme.md` e `jds/acme.md` precisam produzir a MESMA linha, senão a mesma
  // vaga aparece duas vezes no índice.
  const jdPath = relative(careerOpsRoot, abs).split(sep).join('/');
  if (!tsvSafe(jdPath)) return { ok: false, reason: 'jd_path com tab/newline' };

  const index = readIndex(indexPath);
  index.set(key, {
    url: key,
    status: 'ready',
    jdPath,
    chars,
    updated: today(),
  });
  writeIndex(indexPath, index);
  return { ok: true, chars };
}

/**
 * Marcar uma URL como sem job description.
 *
 * A vaga continua no `pipeline.md`, visível no dashboard, fora da avaliação. É
 * o resultado correto para as ~77 do LinkedIn: um muro de login não é uma JD.
 *
 * `reason` NÃO é persistido — o contrato tem cinco colunas (Actual Architecture.md §5).
 * Ele volta no retorno para quem chama imprimir. Se um dia o diagnóstico pedir
 * persistência, é acrescentar `'reason'` a `INDEX_COLUMNS` e a `rowToTsv`.
 *
 * @param {{indexPath: string, url: string, reason?: string}} args
 * @returns {{ok: true, reason: string|null}|{ok: false, reason: string}}
 */
export function markMissing({ indexPath, url, reason }) {
  const key = tsvSafe(url);
  if (!key) return { ok: false, reason: 'URL vazia ou com tab/newline' };
  const index = readIndex(indexPath);
  index.set(key, {
    url: key,
    status: 'missing',
    jdPath: '',
    chars: 0,
    updated: today(),
  });
  writeIndex(indexPath, index);
  return { ok: true, reason: reason ?? null };
}
