#!/usr/bin/env node

/**
 * import-teal.mjs — importar exports CSV do Teal para career-ops/data/pipeline.md.
 *
 * Teal (https://tealhq.com) é uma extensão que salva vagas num tracker pessoal.
 * O export CSV dele é a forma mais rápida de colocar uma shortlist curada no
 * pipeline; colar URL uma por uma não escala.
 *
 * O CSV do Teal NÃO tem coluna de descrição, e a maioria das URLs é LinkedIn.
 * Então toda vaga importada entra no índice jd-ready como `missing`: está no
 * pipeline, visível, fora da avaliação. Quem tenta obter a JD depois é
 * `npm run jd:gather`.
 *
 * Uso:
 *   npm run teal:import                # importa e move os CSVs
 *   npm run teal:import:dry            # pré-visualiza; não escreve nada
 *   npm run teal:import -- --limit=20  # teto; o CSV fica na inbox
 *   npm run teal:import -- --dir=path  # lê CSVs de outra pasta
 */

import {
  importTealCsvs,
  previewLines,
  TEAL_DIR,
  TEAL_PROCESSED_DIR,
} from './teal-import-core.mjs';
import { isMainModule } from '../../career-ops/lib/is-main-module.mjs';

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const limit = limitArg
    ? Number.parseInt(limitArg.slice('--limit='.length), 10)
    : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(
      `--limit expects a positive integer, got "${limitArg.slice('--limit='.length)}"`,
    );
  }
  return {
    dryRun,
    limit,
    dir: dirArg ? dirArg.slice('--dir='.length) : TEAL_DIR,
  };
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`import-teal: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const result = await importTealCsvs(opts);

  if (result.files.length === 0) {
    console.log(`[teal-import] No CSV files found in ${opts.dir}`);
    console.log(
      '[teal-import] Export your saved jobs from Teal and drop the CSV there.',
    );
    return;
  }

  console.log(
    `[teal-import] Read ${result.files.length} CSV file(s): ${result.files.join(', ')}`,
  );
  console.log(
    `[teal-import] ${result.added} new offer(s) ` +
      `· ${result.skippedDuplicate} duplicate(s) skipped ` +
      `· ${result.skippedBlacklist} blacklisted skipped`,
  );

  for (const entry of result.blacklisted) {
    console.log(
      `[teal-import]   blacklisted: ${entry.company} — ${entry.reason}`,
    );
  }

  if (opts.dryRun) {
    for (const line of previewLines(result.offers)) console.log(`  ${line}`);
    console.log('[teal-import] (dry run — nothing written, no files moved)');
    if (result.capped) {
      console.log(
        '[teal-import] Limit reached — a real run would leave the CSV(s) in place',
      );
    }
    return;
  }

  if (result.added > 0) {
    console.log(
      `[teal-import] Appended ${result.added} offer(s); ` +
        `marked ${result.markedMissing} missing in jd-ready. ` +
        'Next: npm run jd:gather -- --browser',
    );
  }
  if (result.capped) {
    console.log(
      `[teal-import] Limit reached — left ${result.files.length} CSV(s) in ${opts.dir} ` +
        'so the next run can continue',
    );
  } else {
    console.log(
      `[teal-import] Moved ${result.files.length} processed CSV(s) to ${TEAL_PROCESSED_DIR}`,
    );
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`import-teal: ${err?.message ?? err}`);
    process.exit(1);
  });
}
