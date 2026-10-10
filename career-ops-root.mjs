/**
 * career-ops-root.mjs — os caminhos que todo plugin deste projeto precisa.
 *
 * Os plugins vivem em `10-20 Modules/` e importam o checkout por caminho
 * relativo. Centralizar isso aqui significa que mover o checkout ou um
 * módulo é uma edição, não quatro.
 *
 * CODE root vs DATA root: `CAREER_OPS_ROOT` é onde estão os `.mjs` e o `web/`.
 * Onde estão `data/` e `jds/` é outra pergunta, respondida por
 * `career-ops/path-resolver.mjs` → `getCareerOpsRoot()`. Hoje os dois coincidem;
 * nenhum plugin deve assumir que vão continuar coincidendo.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz deste projeto — a pasta que contém os plugins e o checkout. */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** Checkout upstream. CODE root do career-ops. */
export const CAREER_OPS_ROOT = join(PROJECT_ROOT, 'career-ops');

/** Pasta dos módulos Johnny Decimal. */
export const MODULES_DIR = join(PROJECT_ROOT, '10-20 Modules');

export const JD_READY_DIR = join(MODULES_DIR, '01_jd-ready');
export const SEARCH_TEAL_DIR = join(MODULES_DIR, '02_search-teal');
export const BATCH_ANTHROPIC_DIR = join(MODULES_DIR, '03_batch-anthropic');
export const DASHBOARD_DIR = join(MODULES_DIR, '04_dashboard');
export const SCAN_GUPY_DIR = join(MODULES_DIR, '05_scan-gupy');
export const SCAN_INDEED_DIR = join(MODULES_DIR, '06_scan-indeed');
export const SCAN_LINKEDIN_DIR = join(MODULES_DIR, '07_scan-linkedin');

/**
 * O índice de contrato. Runtime, gitignored, reconstruível.
 * Manter o default de `jdIndexPath` em `04_dashboard/read-jd-index.mjs`
 * alinhado a este path — aquele arquivo é copiado para dentro do Next e
 * não pode importar este módulo.
 */
export const JD_INDEX_PATH = join(JD_READY_DIR, 'jd-ready.tsv');
