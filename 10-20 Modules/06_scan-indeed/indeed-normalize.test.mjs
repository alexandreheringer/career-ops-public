import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTargetLocation } from './location-allow.mjs';
import {
  normalizeIndeedItem,
  normalizeIndeedItems,
} from './indeed-normalize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/indeed-items.json'), 'utf8'),
);

test('fixture vira oferta scan-indeed com Lisboa na URL do jobKey', () => {
  const offer = normalizeIndeedItem(FIXTURE[0]);
  assert.equal(offer.source, 'scan-indeed');
  assert.equal(offer.company, 'Acme');
  assert.equal(offer.title, 'Senior Data Engineer');
  assert.equal(offer.url, 'https://www.indeed.com/viewjob?jk=abc123');
  assert.match(offer.location, /Lisboa/);
  assert.equal(isTargetLocation(offer.location), true);
});

test('item sem título sai', () => {
  const offers = normalizeIndeedItems([
    FIXTURE[0],
    { companyName: 'Sem título', jobKey: 'abc123', city: 'Lisboa' },
  ]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].company, 'Acme');
});

test('jobKey com barra não vira URL', () => {
  const offer = normalizeIndeedItem({
    title: 'Cargo',
    companyName: 'Evil',
    jobKey: '../etc',
    city: 'Lisboa',
    country: 'Portugal',
  });
  assert.equal(offer.url, '');
  assert.equal(offer.url.includes('../etc'), false);
  assert.equal(
    normalizeIndeedItems([
      {
        title: 'Cargo',
        companyName: 'Evil',
        jobKey: '../etc',
      },
    ]).length,
    0,
  );
});

test('Austin com carimbo Remote ainda passa na allowlist', () => {
  const offer = normalizeIndeedItem({
    title: 'Data Engineer',
    companyName: 'RemoteCo',
    jobUrl: 'https://www.indeed.com/viewjob?jk=austin1',
    location: 'Austin',
    __searchLocation: 'Remote',
  });
  assert.match(offer.location, /Austin/);
  assert.match(offer.location, /Remote/);
  assert.equal(isTargetLocation(offer.location), true);
});
