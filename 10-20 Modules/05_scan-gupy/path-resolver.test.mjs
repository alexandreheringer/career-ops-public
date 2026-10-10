import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function source(name) {
  return readFileSync(join(HERE, name), 'utf8');
}

function moduleSources() {
  return readdirSync(HERE)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map((name) => ({ name, text: source(name) }));
}

test('CLI e núcleo resolvem caminho pela âncora, sem path absoluto', () => {
  const cli = source('scan-gupy.mjs');
  const core = source('gupy-scan-core.mjs');
  for (const text of [cli, core]) {
    assert.match(text, /from '\.\.\/\.\.\/career-ops-root\.mjs'/);
    assert.equal(text.includes('/Users/'), false);
    assert.equal(text.includes('21.11-Career-Ops'), false);
    assert.equal(text.includes('career-ops/data'), false);
  }
  assert.match(cli, /getCareerOpsRoot/);
});

test('nenhum arquivo do módulo usa shell nem importa o vizinho', () => {
  for (const { name, text } of moduleSources()) {
    assert.equal(text.includes('execSync('), false, name);
    const importLines = text
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line) || /from\s+['"]/.test(line));
    const joined = importLines.join('\n');
    assert.equal(joined.includes('06_scan-indeed'), false, name);
    assert.equal(joined.includes('07_scan-linkedin'), false, name);
    assert.equal(joined.includes('03_batch-anthropic'), false, name);
    assert.equal(joined.includes('playwright'), false, name);
  }
});
