import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateOffers, readPendingOffers } from './gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Índice falso: o formato é o mesmo Map que readIndex devolve. */
function fakeIndex(rows) {
  return new Map(
    rows.map((r) => [r.url, { chars: 0, updated: '', jdPath: '', ...r }]),
  );
}

const noBlacklist = () => null;
const allowAll = () => null;

const ASHBY = {
  url: 'https://jobs.ashbyhq.com/acme/1',
  company: 'Acme',
  role: 'Data Engineer',
};
const LINKEDIN = {
  url: 'https://www.linkedin.com/jobs/view/3',
  company: 'Open Finance',
  role: 'Coordenador',
};
const LOCAL = {
  url: 'local:jds/captura-manual.md',
  company: 'Manual',
  role: 'Dev',
};

test('URL ready entra, URL missing fica fora com motivo legível', () => {
  const jdIndex = fakeIndex([
    {
      url: ASHBY.url,
      status: 'ready',
      jdPath: 'jds/acme-data-engineer-ab12cd34.md',
    },
    { url: LINKEDIN.url, status: 'missing' },
  ]);

  const { candidates, skipped } = gateOffers({
    offers: [ASHBY, LINKEDIN],
    jdIndex,
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: allowAll,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, ASHBY.url);
  assert.equal(candidates[0].jdRel, 'jds/acme-data-engineer-ab12cd34.md');

  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].url, LINKEDIN.url);
  assert.match(skipped[0].reason, /sem job description/);
});

test('URL ausente do índice é tratada como missing, não como desconhecida', () => {
  const { candidates, skipped } = gateOffers({
    offers: [ASHBY],
    jdIndex: fakeIndex([]),
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: allowAll,
  });
  assert.equal(candidates.length, 0);
  assert.match(skipped[0].reason, /sem job description/);
});

test('ready sem jd_path não entra: ready é "o arquivo está ali", não um rótulo', () => {
  const jdIndex = fakeIndex([{ url: ASHBY.url, status: 'ready', jdPath: '' }]);
  const { candidates } = gateOffers({
    offers: [ASHBY],
    jdIndex,
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: allowAll,
  });
  assert.equal(candidates.length, 0);
});

test('entrada local: passa sem consultar o índice — ela já carrega a captura', () => {
  const { candidates } = gateOffers({
    offers: [LOCAL],
    jdIndex: fakeIndex([]),
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: allowAll,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].jdRel, undefined);
});

test('blacklist vem antes do gate de JD: o motivo reportado é a blacklist', () => {
  const jdIndex = fakeIndex([
    { url: ASHBY.url, status: 'ready', jdPath: 'jds/a.md' },
  ]);
  const { candidates, skipped } = gateOffers({
    offers: [ASHBY],
    jdIndex,
    blacklist: [],
    findBlacklist: () => ({ company: 'Acme', reason: 'processo horrível' }),
    rejectUrl: allowAll,
  });
  assert.equal(candidates.length, 0);
  assert.match(skipped[0].reason, /blacklisted \(Acme\): processo horrível/);
});

test('URL bloqueada pelo guard de SSRF não chega ao gate de JD', () => {
  const jdIndex = fakeIndex([
    { url: 'http://169.254.169.254/x', status: 'ready', jdPath: 'jds/a.md' },
  ]);
  const { candidates, skipped } = gateOffers({
    offers: [
      { url: 'http://169.254.169.254/x', company: 'Meta', role: 'Data' },
    ],
    jdIndex,
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: () => ({ reason: 'link-local address' }),
  });
  assert.equal(candidates.length, 0);
  assert.match(skipped[0].reason, /blocked URL: link-local address/);
});

test('o limite conta vagas aprovadas, não linhas do pipeline', () => {
  // Esta é a ordem real do pipeline: LinkedIn em bloco no topo, porque veio do
  // Teal. Um limite aplicado antes dos gates pegaria só LinkedIn e enviaria
  // ZERO. É o bug que este teste existe para impedir de voltar.
  const linkedins = Array.from({ length: 5 }, (_, i) => ({
    url: `https://www.linkedin.com/jobs/view/${i}`,
    company: `Co${i}`,
    role: 'Data',
  }));
  const ashbys = Array.from({ length: 4 }, (_, i) => ({
    url: `https://jobs.ashbyhq.com/acme/${i}`,
    company: `Acme${i}`,
    role: 'Data',
  }));

  const jdIndex = fakeIndex([
    ...linkedins.map((o) => ({ url: o.url, status: 'missing' })),
    ...ashbys.map((o) => ({
      url: o.url,
      status: 'ready',
      jdPath: `jds/acme-${o.url.slice(-1)}.md`,
    })),
  ]);

  const { candidates, skipped, gatedCount } = gateOffers({
    offers: [...linkedins, ...ashbys],
    jdIndex,
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: allowAll,
    limit: 2,
  });

  assert.equal(gatedCount, 4, 'as quatro do Ashby passam os gates');
  assert.equal(
    candidates.length,
    2,
    'o limite leva 2 das aprovadas, não 2 do topo da lista',
  );
  assert.ok(candidates.every((c) => c.url.includes('ashbyhq')));
  assert.equal(
    skipped.length,
    5,
    'as cortadas pelo limite NÃO são skipped: voltam na próxima rodada',
  );
});

test('sem limite, candidates e gatedCount são a mesma coisa', () => {
  const jdIndex = fakeIndex([
    { url: ASHBY.url, status: 'ready', jdPath: 'jds/a.md' },
  ]);
  const { candidates, gatedCount } = gateOffers({
    offers: [ASHBY],
    jdIndex,
    blacklist: [],
    findBlacklist: noBlacklist,
    rejectUrl: allowAll,
  });
  assert.equal(candidates.length, 1);
  assert.equal(gatedCount, 1);
});

test('gate.mjs carrega sem o checkout career-ops', () => {
  const source = readFileSync(join(HERE, 'gate.mjs'), 'utf-8');
  const needle = ['career', '-ops/'].join('');
  assert.equal(source.includes(needle), false);
});

test('readPendingOffers continua lendo todas as formas de linha e ignora `- [x]`', () => {
  const offers = readPendingOffers(
    [
      '## Pending',
      '- [ ] https://jobs.ashbyhq.com/acme/1 | Acme | Data Engineer',
      '- [x] https://jobs.ashbyhq.com/acme/2 | Acme | Já processada',
      '- [ ] local:jds/captura.md | Manual | Dev',
      'linha solta',
    ].join('\n'),
  );

  assert.deepEqual(
    offers.map((o) => o.url),
    ['https://jobs.ashbyhq.com/acme/1', 'local:jds/captura.md'],
  );
});
