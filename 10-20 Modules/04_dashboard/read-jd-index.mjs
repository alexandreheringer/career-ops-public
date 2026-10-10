/**
 * read-jd-index.mjs — ler jd-ready/jd-ready.tsv de dentro do app Next.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ FONTE. `npm run dashboard:apply` copia este arquivo para             │
 * │ career-ops/web/src/lib/read-jd-index.mjs. Edite AQUI, nunca lá.      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Por que uma cópia e não um import de fora: o grafo de build do Next não
 * alcança arquivo fora de `web/`. Um import do módulo 01_jd-ready funciona
 * no `next dev` e quebra o `next build`.
 *
 * Reimplementa a leitura em vez de importar `jd-ready.mjs` porque esta
 * cópia só precisa de UMA pergunta — "quais URLs estão ready?" — e porque ela
 * roda no servidor do Next, onde carregar o módulo de escrita seria carregar
 * código que a tela nunca usa.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Onde está o índice, visto de dentro do `web/`.
 *
 * `careerOpsRoot()` devolve o DATA root do career-ops; o projeto dos plugins é o
 * pai dele. O default abaixo TEM de ficar alinhado a `JD_INDEX_PATH` em
 * `career-ops-root.mjs` — este arquivo é copiado para o Next e não pode
 * importar aquele módulo. `CAREER_OPS_JD_INDEX` tem precedência para o caso de
 * o data root ser separado do checkout (`career-ops/DATA_CONTRACT.md`, layout
 * #524) — aí o pai do data root não é o projeto dos plugins.
 *
 * @param {string} careerOpsRoot
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function jdIndexPath(careerOpsRoot, env = process.env) {
  if (env.CAREER_OPS_JD_INDEX) return env.CAREER_OPS_JD_INDEX;
  return path.join(
    path.resolve(careerOpsRoot, '..'),
    '10-20 Modules',
    '01_jd-ready',
    'jd-ready.tsv',
  );
}

/**
 * As URLs com status `ready`.
 *
 * Índice ausente devolve conjunto vazio — "ninguém rodou o gather ainda" é um
 * estado normal da instalação, e a tela tem que renderizar. O resultado é todo
 * tick vazio, que é a verdade.
 *
 * @param {string} indexPath
 * @returns {Set<string>}
 */
export function readJdReadyUrls(indexPath) {
  const ready = new Set();
  let text;
  try {
    text = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return ready;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('url\t')) continue;
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const url = line.slice(0, tab);
    const status = line
      .slice(tab + 1)
      .split('\t')[0]
      ?.trim();
    if (status === 'ready') ready.add(url);
  }
  return ready;
}
