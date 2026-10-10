import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeLinkedInItem,
  normalizeLinkedInItems,
} from './linkedin-normalize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/linkedin-items.json'), 'utf8'),
);

test('fixture vira oferta scan-linkedin com postedAt numérico', () => {
  const offer = normalizeLinkedInItem(FIXTURE[0]);
  assert.equal(offer.source, 'scan-linkedin');
  assert.equal(offer.title, 'Senior Data Engineer');
  assert.equal(offer.company, 'Acme');
  assert.equal(offer.location, 'Portugal');
  assert.equal(offer.url, 'https://www.linkedin.com/jobs/view/123');
  assert.equal(typeof offer.postedAt, 'number');
  assert.equal(Object.hasOwn(offer, 'description'), false);
});

test('item sem URL sai', () => {
  const offers = normalizeLinkedInItems([
    FIXTURE[0],
    { title: 'Sem link', company: 'Acme', jobId: '9', description: 'texto' },
  ]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].company, 'Acme');
});

test('data ilegível omite postedAt', () => {
  const offer = normalizeLinkedInItem({
    title: 'Cargo',
    company: 'Acme',
    url: 'https://www.linkedin.com/jobs/view/9',
    postedDate: 'não-é-data',
    description: 'texto',
  });
  assert.equal(Object.hasOwn(offer, 'postedAt'), false);
  assert.equal(Object.hasOwn(offer, 'description'), false);
});
