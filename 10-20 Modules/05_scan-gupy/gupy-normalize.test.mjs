import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGupyItem, normalizeGupyItems } from './gupy-normalize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/gupy-items.json'), 'utf8'),
);

test('item confirmado do actor vira oferta scan-gupy', () => {
  const offer = normalizeGupyItem(FIXTURE[0]);
  assert.equal(offer.source, 'scan-gupy');
  assert.equal(offer.title, 'Analista de Dados');
  assert.equal(offer.company, 'Acme');
  assert.equal(offer.url, 'https://acme.gupy.io/job/1');
  assert.equal(offer.location, 'São Paulo, SP');
});

test('item enxuto usa title, url e company string', () => {
  const offer = normalizeGupyItem(FIXTURE[1]);
  assert.equal(offer.title, 'Engenheiro de Dados');
  assert.equal(offer.url, 'https://beta.gupy.io/job/2');
  assert.equal(offer.company, 'Beta');
  assert.equal(offer.location, 'Brasil');
  assert.equal(offer.source, 'scan-gupy');
});

test('item sem URL é descartado', () => {
  const offers = normalizeGupyItems(FIXTURE);
  assert.equal(offers.length, 2);
  assert.equal(
    offers.some((offer) => offer.company === 'Gamma'),
    false,
  );
});
