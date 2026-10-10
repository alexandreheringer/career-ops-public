import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_LINKEDIN_DIR } from '../../career-ops-root.mjs';

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
  assert.equal(SCAN_LINKEDIN_DIR.endsWith('07_scan-linkedin'), true);
});

test('CLI e núcleo importam a âncora e o CLI chama getCareerOpsRoot', () => {
  for (const name of ['scan-linkedin.mjs', 'linkedin-scan-core.mjs']) {
    const text = source(name);
    assert.match(text, /from '\.\.\/\.\.\/career-ops-root\.mjs'/, name);
    assert.equal(text.includes('/Users/'), false, name);
    assert.equal(text.includes('career-ops/data'), false, name);
  }
  assert.match(source('scan-linkedin.mjs'), /getCareerOpsRoot\(/);
});

test('nenhum mjs tem path absoluto, execSync, playwright ou import de vizinho', () => {
  const bannedEverywhere = [
    '/Users/',
    'career-ops/data',
    'execSync(',
    'playwright',
    'scratch-linkedin',
  ];
  const bannedInCode = [
    '05_scan-gupy',
    '06_scan-indeed',
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

test('o módulo não marca ready nem baixa a descrição', () => {
  const banned = ['jd-ready', 'markOffersMissing', 'isLinkedIn', 'gather.mjs'];
  for (const { name, text } of moduleSources()) {
    for (const token of banned) {
      assert.equal(text.includes(token), false, `${name} ${token}`);
    }
  }
});

test('o id do actor vive só no mapa de queries', () => {
  for (const { name, text } of moduleSources()) {
    const present = text.includes('cryptosignals~linkedin-jobs-scraper');
    assert.equal(present, name === 'linkedin-queries.mjs', name);
  }
});

test('o mapa e a allowlist apontam a cópia irmã sem importar', () => {
  const queries = source('linkedin-queries.mjs').split('\n')[0];
  assert.match(queries, /06_scan-indeed\/indeed-queries\.mjs/);
  assert.match(queries, /Não importar/);
  const allow = source('location-allow.mjs');
  assert.match(allow, /05_scan-gupy\/location-allow\.mjs/);
  assert.match(allow, /06_scan-indeed\/location-allow\.mjs/);
  assert.match(allow, /sem import/);
});
