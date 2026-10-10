import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApifyToken } from './load-apify-token.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('APIFY_TOKEN longo devolve source env', () => {
  const result = loadApifyToken({
    env: { APIFY_TOKEN: 'apify_api_test_token_value' },
  });
  assert.equal(result.source, 'env');
  assert.equal(result.token, 'apify_api_test_token_value');
});

test('OP_APIFY_REF com ponto e vírgula é recusada antes do shell', () => {
  assert.throws(
    () => loadApifyToken({ env: { OP_APIFY_REF: 'op://vault; rm -rf /' } }),
    /refused rather than passed to the shell/,
  );
});

test('o loader não contém execSync(', () => {
  const text = readFileSync(join(HERE, 'load-apify-token.mjs'), 'utf8');
  assert.equal(text.includes('execSync('), false);
});
