#!/usr/bin/env node

/**
 * apply.mjs — aplicar, verificar e reverter as edições do dashboard.
 *
 * ## Por que isto existe
 *
 * `career-ops/web/` é camada de sistema: `update-system.mjs` sobrescreve. E
 * `career-ops/` está no `.gitignore` da raiz, então um commit nosso NÃO protege
 * nada editado lá dentro. A fonte da verdade são os módulos de
 * `dashboard/edits/`. Este script é o que torna a edição reproduzível.
 *
 * ## Duas passadas
 *
 * Valida TODAS as âncoras antes de escrever qualquer arquivo. 22 edições em 5
 * arquivos: aplicar 18 e falhar na décima nona deixaria o app sem compilar e sem um
 * estado óbvio para voltar. Então: se uma âncora não bate, nada é escrito.
 *
 * Uso:
 *   npm run dashboard:apply             aplica
 *   npm run dashboard:check             só relata o estado; não escreve
 *   npm run dashboard:revert            restaura do backup
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

import {
  CAREER_OPS_ROOT,
  DASHBOARD_DIR,
  PROJECT_ROOT,
} from '../../career-ops-root.mjs';
import { editStateFromContent } from './edit-state.mjs';
import { edits } from './edits/index.mjs';

const BACKUP_DIR = join(DASHBOARD_DIR, '.backup');

/** Arquivos que o apply COPIA (não edita) para dentro do web. */
const COPIES = [
  {
    from: join(DASHBOARD_DIR, 'read-jd-index.mjs'),
    to: 'web/src/lib/read-jd-index.mjs',
  },
];

const target = (rel) => join(CAREER_OPS_ROOT, rel);

/**
 * Em que estado está esta edição?
 *
 * `applied` tem precedência sobre `ready`: se o texto final já está lá, não
 * importa que a âncora também esteja (ela normalmente faz parte do resultado).
 *
 * @returns {'applied'|'ready'|'missing-file'|'anchor-not-found'|'anchor-ambiguous'}
 */
function stateOf(edit) {
  const path = target(edit.file);
  if (!existsSync(path)) return 'missing-file';
  const content = readFileSync(path, 'utf-8');
  return editStateFromContent(content, edit);
}

function backupOnce(rel) {
  const dest = join(BACKUP_DIR, rel);
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(target(rel), dest);
}

function listBackups(dir = BACKUP_DIR, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(...listBackups(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function revert() {
  const files = listBackups();
  if (files.length === 0) {
    console.log('Nenhum backup em dashboard/.backup/. Nada a reverter.');
    console.log(
      'Se o career-ops foi atualizado depois do apply, o update já reverteu por você.',
    );
    return 0;
  }
  for (const rel of files) {
    copyFileSync(join(BACKUP_DIR, rel), target(rel));
    console.log(`  restaurado  ${rel}`);
  }
  console.log(
    `\n${files.length} arquivo(s) restaurado(s). A cópia gerada read-jd-index.mjs continua lá (inofensiva, ninguém a importa).`,
  );
  console.log(
    'Não rode --revert depois de um update-system.mjs: o backup é o web/ de ANTES do update, e restaurá-lo por cima do checkout novo desfaz o update.',
  );
  return 0;
}

function main(argv) {
  const check = argv.includes('--check');
  if (argv.includes('--revert')) return revert();
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'Uso: npm run dashboard:apply | npm run dashboard:check | npm run dashboard:revert',
    );
    return 0;
  }

  console.log('=== dashboard · edições do career-ops/web ===');
  console.log(`Alvo: ${relative(PROJECT_ROOT, CAREER_OPS_ROOT)}/web`);
  console.log(
    `${edits.length} edição(ões) em ${new Set(edits.map((e) => e.file)).size} arquivo(s)\n`,
  );

  // ── passada 1: validar tudo ──
  const states = edits.map((edit) => ({ edit, state: stateOf(edit) }));
  const problems = states.filter(
    (s) =>
      s.state === 'anchor-not-found' ||
      s.state === 'anchor-ambiguous' ||
      s.state === 'missing-file',
  );

  for (const { edit, state } of states) {
    const mark = {
      applied: '  já aplicado ',
      ready: '  aplicaria   ',
      'missing-file': '  ARQUIVO AUSENTE ',
      'anchor-not-found': '  ÂNCORA AUSENTE  ',
      'anchor-ambiguous': '  ÂNCORA AMBÍGUA  ',
    }[state];
    console.log(`${mark} ${edit.file} · ${edit.label}`);
  }

  if (problems.length) {
    console.error(`\n${problems.length} problema(s). NADA foi escrito.`);
    console.error(
      '\nO career-ops provavelmente foi atualizado e os trechos alvo mudaram.',
    );
    console.error('O que fazer, por edição com problema:');
    console.error('  1. abra o arquivo alvo e localize o trecho equivalente');
    console.error(
      '  2. atualize `anchor` e `replacement` no módulo de dashboard/edits/',
    );
    console.error('  3. rode de novo\n');
    for (const { edit, state } of problems) {
      console.error(`  [${state}] ${edit.file} · ${edit.label}`);
      console.error(
        `    âncora: ${JSON.stringify(edit.anchor.slice(0, 90))}${edit.anchor.length > 90 ? '…' : ''}`,
      );
    }
    return 1;
  }

  const pending = states.filter((s) => s.state === 'ready');
  if (check) {
    console.log(
      `\n--check: ${states.length - pending.length} aplicada(s), ${pending.length} pendente(s). Nada escrito.`,
    );
    return pending.length === 0 ? 0 : 2;
  }

  // ── passada 2: copiar e escrever ──
  for (const copy of COPIES) {
    const dest = target(copy.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(copy.from, dest);
    console.log(`\n  copiado     ${copy.to}`);
  }

  if (pending.length === 0) {
    console.log('\nTodas as edições já estavam aplicadas. Nada a fazer.');
    return 0;
  }

  // Agrupado por arquivo: um readFileSync e um writeFileSync por arquivo, e as
  // edições do mesmo arquivo aplicadas sobre o conteúdo em memória — senão a
  // segunda edição leria o arquivo de antes da primeira.
  const byFile = new Map();
  for (const { edit } of pending) {
    if (!byFile.has(edit.file)) byFile.set(edit.file, []);
    byFile.get(edit.file).push(edit);
  }

  for (const [file, fileEdits] of byFile) {
    backupOnce(file);
    let content = readFileSync(target(file), 'utf-8');
    for (const edit of fileEdits) {
      content = content.replace(edit.anchor, edit.replacement);
      console.log(`  aplicado    ${file} · ${edit.label}`);
    }
    writeFileSync(target(file), content, 'utf-8');
  }

  console.log(
    `\n✅ ${pending.length} edição(ões) aplicada(s). Backup em dashboard/.backup/.`,
  );
  console.log('\nPróximo:');
  console.log('  cd career-ops/web && npm run build     # ou npm run dev');
  console.log('  abra /pipeline');
  console.log(
    '\nDepois de um update do career-ops, rode este comando de novo.',
  );
  return 0;
}

process.exit(main(process.argv.slice(2)));
