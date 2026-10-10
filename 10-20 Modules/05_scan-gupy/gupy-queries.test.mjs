import test from 'node:test';
import assert from 'node:assert/strict';
import { GUPY_CURATED_TERMS, buildGupyInputs } from './gupy-queries.mjs';

test('perfil vazio gera os 11 termos curtos, sem OR', () => {
  const inputs = buildGupyInputs({});
  assert.equal(inputs.length, GUPY_CURATED_TERMS.length);
  assert.equal(inputs.length, 11);
  for (const input of inputs) {
    assert.equal(input.state, '');
    assert.equal(input.sortBy, 'newest');
    assert.equal(input.maxResults, 50);
    assert.equal(input.searchTerm.includes(' OR '), false);
  }
  assert.deepEqual(
    inputs.map((input) => input.searchTerm),
    GUPY_CURATED_TERMS,
  );
});

test('test mode corta em 3 termos e 15 resultados', () => {
  const inputs = buildGupyInputs({}, { testMode: true });
  assert.equal(inputs.length, 3);
  assert.equal(
    inputs.every((input) => input.maxResults === 15),
    true,
  );
});

test('termo longo, termo com OR e duplicata não entram', () => {
  const inputs = buildGupyInputs({
    target_roles: {
      primary: [
        'analista de dados',
        'x'.repeat(41),
        'foo OR bar',
        'pessoa de dados',
      ],
    },
  });
  const terms = inputs.map((input) => input.searchTerm);
  assert.equal(terms.filter((term) => term === 'analista de dados').length, 1);
  assert.equal(terms.includes('pessoa de dados'), true);
  assert.equal(terms.includes('x'.repeat(41)), false);
  assert.equal(terms.includes('foo OR bar'), false);
  assert.equal(
    terms.some((term) => term.includes(' OR ')),
    false,
  );
});
