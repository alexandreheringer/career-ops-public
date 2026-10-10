import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_INDEED_DIR } from '../../career-ops-root.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function source(name) {
  return readFileSync(join(HERE, name), 'utf8');
}

function moduleSources() {
  return readdirSync(HERE)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map((name) => ({ name, text: source(name) }));
}

function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('a âncora aponta para este módulo', () => {
  assert.equal(SCAN_INDEED_DIR.endsWith('06_scan-indeed'), true);
});

test('o CLI importa a âncora e chama getCareerOpsRoot', () => {
  const cli = source('scan-indeed.mjs');
  assert.match(cli, /from '\.\.\/\.\.\/career-ops-root\.mjs'/);
  assert.match(cli, /getCareerOpsRoot\(/);
  assert.equal(cli.includes('/Users/'), false);
  assert.equal(cli.includes('career-ops/data'), false);
});

test('nenhum mjs tem path absoluto, execSync, playwright ou import de vizinho', () => {
  const bannedEverywhere = [
    '/Users/',
    'career-ops/data',
    'execSync(',
    'playwright',
  ];
  const bannedInCode = [
    '05_scan-gupy',
    '07_scan-linkedin',
    '03_batch-anthropic',
    'playwright',
  ];
  for (const { name, text } of moduleSources()) {
    for (const token of bannedEverywhere) {
      assert.equal(text.includes(token), false, `${name} ${token}`);
    }
    const code = codeOnly(text);
    for (const token of bannedInCode) {
      assert.equal(code.includes(token), false, `${name} ${token}`);
    }
  }
});

test('o id do actor vive só no mapa de queries', () => {
  for (const { name, text } of moduleSources()) {
    const present = text.includes('MXLpngmVpE8WTESQr');
    assert.equal(present, name === 'indeed-queries.mjs', name);
  }
});

test('o mapa e a allowlist apontam a cópia irmã sem importar', () => {
  const queries = source('indeed-queries.mjs').split('\n')[0];
  assert.match(queries, /07_scan-linkedin\/linkedin-queries\.mjs/);
  assert.match(queries, /Não importar/);
  const allow = source('location-allow.mjs');
  assert.match(allow, /05_scan-gupy\/location-allow\.mjs/);
  assert.match(allow, /07_scan-linkedin\/location-allow\.mjs/);
  assert.match(allow, /sem import/);
});
