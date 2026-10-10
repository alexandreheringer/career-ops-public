import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApifyToken } from './load-apify-token.mjs';

test('APIFY_TOKEN no ambiente devolve source env', () => {
  const result = loadApifyToken({
    env: { APIFY_TOKEN: 'apify_api_test_token_value' },
  });
  assert.equal(result.source, 'env');
  assert.equal(result.token, 'apify_api_test_token_value');
});

test('referência 1Password com metacaractere é recusada antes do shell', () => {
  assert.throws(
    () => loadApifyToken({ env: { OP_APIFY_REF: 'op://vault; rm -rf /' } }),
    /refused rather than passed to the shell/,
  );
});

test('token curto demais é recusado', () => {
  assert.throws(
    () => loadApifyToken({ env: { APIFY_TOKEN: 'abcd' } }),
    /No Apify token found/,
  );
});
