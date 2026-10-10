import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCsv,
  parseTealCsv,
  markOffersMissing,
  SKIP_STATUSES,
} from './teal-parse.mjs';
import { readIndex, countByStatus, isReady } from '../01_jd-ready/jd-ready.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(
  path.join(HERE, 'fixtures/teal-sample.csv'),
  'utf-8',
);

test('parseCsv lida com campo citado, vírgula dentro e aspas escapadas', () => {
  const rows = parseCsv('a,b\n"um, dois","diz ""oi"""\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['um, dois', 'diz "oi"'],
  ]);
});

test('parseTealCsv resolve colunas por nome e descarta o que precisa ser descartado', () => {
  const offers = parseTealCsv(SAMPLE);
  // 5 linhas: 2 válidas, 1 arquivada, 1 rejeitada, 1 sem URL
  assert.equal(offers.length, 2);
  assert.deepEqual(
    offers.map((o) => o.company),
    ['Open Finance Brasil', 'GitLab'],
  );
});

test('arquivada, status morto e linha sem URL são descartadas', () => {
  const urls = parseTealCsv(SAMPLE).map((o) => o.url);
  assert.equal(urls.includes('https://example.com/arquivada'), false);
  assert.equal(urls.includes('https://example.com/rejeitada'), false);
  assert.ok(SKIP_STATUSES.has('archived'));
  assert.ok(SKIP_STATUSES.has('rejected'));
});

test('salário, data e nota são normalizados para o que o formatPipelineOffer espera', () => {
  const gitlab = parseTealCsv(SAMPLE).find((o) => o.company === 'GitLab');
  assert.deepEqual(gitlab.salary, {
    min: 104800,
    max: 176400,
    currency: 'USD',
  });
  assert.equal(typeof gitlab.postedAt, 'number'); // epoch ms
  assert.match(gitlab.note, /via ChromeExtension/);
  assert.match(gitlab.note, /excitement 3/);
  assert.match(gitlab.note, /teal/);
  // o cargo perde espaço duplo e ponto final
  const openFinance = parseTealCsv(SAMPLE).find(
    (o) => o.company === 'Open Finance Brasil',
  );
  assert.equal(openFinance.title.endsWith('.'), false);
  assert.equal(openFinance.title.includes('  '), false);
});

test('markOffersMissing marca toda vaga como missing, nunca ready', () => {
  const indexPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'teal-')),
    'jd-ready.tsv',
  );
  const offers = parseTealCsv(SAMPLE);

  const marked = markOffersMissing({ indexPath, offers });

  assert.equal(marked, 2);
  const index = readIndex(indexPath);
  assert.deepEqual(countByStatus(index), { ready: 0, missing: 2 });
  for (const offer of offers) assert.equal(isReady(index, offer.url), false);
});

test('markOffersMissing é idempotente: duas chamadas, duas linhas, não quatro', () => {
  const indexPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'teal-')),
    'jd-ready.tsv',
  );
  const offers = parseTealCsv(SAMPLE);
  markOffersMissing({ indexPath, offers });
  markOffersMissing({ indexPath, offers });
  assert.equal(readIndex(indexPath).size, 2);
});

test('markOffersMissing não rebaixa uma URL que já está ready', () => {
  const indexPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'teal-')),
    'jd-ready.tsv',
  );
  const offers = parseTealCsv(SAMPLE);
  const gitlab = offers.find((o) => o.company === 'GitLab');
  writeFileSync(
    indexPath,
    [
      'url\tstatus\tjd_path\tchars\tupdated',
      `${gitlab.url}\tready\tjds/gitlab.md\t900\t2026-10-01`,
      '',
    ].join('\n'),
  );

  const marked = markOffersMissing({ indexPath, offers });

  assert.equal(marked, 1);
  const index = readIndex(indexPath);
  assert.equal(isReady(index, gitlab.url), true);
  assert.equal(
    index.get(offers.find((o) => o.company === 'Open Finance Brasil').url)
      .status,
    'missing',
  );
});

test('teal-parse.mjs carrega sem o checkout career-ops', () => {
  const source = readFileSync(path.join(HERE, 'teal-parse.mjs'), 'utf-8');
  const needle = ['career', '-ops/'].join('');
  assert.equal(source.includes(needle), false);
});
