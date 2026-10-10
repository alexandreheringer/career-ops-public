import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gatherOffers } from './gather.mjs';
import { readIndex, isReady, jdPathFor, countByStatus } from './jd-ready.mjs';
import { jdFileName } from './jd-fetch.mjs';

const LONG = 'Responsabilidades da vaga. '.repeat(40); // > 400 caracteres

function env() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gather-'));
  const career = path.join(dir, 'career-ops');
  mkdirSync(path.join(career, 'jds'), { recursive: true });
  return { indexPath: path.join(dir, 'jd-ready.tsv'), careerOpsRoot: career };
}

const OFFERS = [
  {
    url: 'https://jobs.ashbyhq.com/acme/1',
    company: 'Acme',
    role: 'Data Engineer',
  },
  { url: 'https://careers.vazia.com/2', company: 'Vazia', role: 'Analyst' },
  {
    url: 'https://www.linkedin.com/jobs/view/3',
    company: 'Open Finance',
    role: 'Coordenador',
  },
];

test('texto longo vira ready com arquivo em jds/; vazio vira missing', async () => {
  const { indexPath, careerOpsRoot } = env();
  const calls = [];
  const fetchJd = async (url) => {
    calls.push(url);
    return url.includes('acme')
      ? { text: LONG, source: 'fake', error: null }
      : { text: null, source: null, error: 'sem texto' };
  };

  const result = await gatherOffers({
    offers: OFFERS,
    indexPath,
    careerOpsRoot,
    fetchJd,
  });

  const index = readIndex(indexPath);
  assert.equal(isReady(index, OFFERS[0].url), true);
  assert.equal(isReady(index, OFFERS[1].url), false);
  assert.equal(isReady(index, OFFERS[2].url), false);
  assert.deepEqual(countByStatus(index), { ready: 1, missing: 2 });
  assert.deepEqual(
    { ready: result.ready, missing: result.missing, skipped: result.skipped },
    { ready: 1, missing: 2, skipped: 0 },
  );

  // o arquivo existe, o índice aponta para ele, e o texto está lá
  const rel = jdPathFor(index, OFFERS[0].url);
  assert.equal(rel, `jds/${jdFileName(OFFERS[0])}`);
  const body = readFileSync(path.join(careerOpsRoot, rel), 'utf-8');
  assert.match(body, /Responsabilidades da vaga/);
  assert.match(body, /Source: https:\/\/jobs\.ashbyhq\.com\/acme\/1/);
});

test('LinkedIn nunca chega ao fetch', async () => {
  const { indexPath, careerOpsRoot } = env();
  const calls = [];
  const fetchJd = async (url) => {
    calls.push(url);
    return { text: LONG, source: 'fake', error: null };
  };

  await gatherOffers({ offers: OFFERS, indexPath, careerOpsRoot, fetchJd });

  assert.equal(
    calls.includes(OFFERS[2].url),
    false,
    'LinkedIn foi buscado e não devia',
  );
  assert.equal(isReady(readIndex(indexPath), OFFERS[2].url), false);
});

test('muro de login não vira ready mesmo passando de 400 caracteres', async () => {
  const { indexPath, careerOpsRoot } = env();
  const wall = `Sign in to view this job. ${'blá '.repeat(200)}`;
  assert.ok(wall.length > 400);
  const fetchJd = async () => ({ text: wall, source: 'fake', error: null });

  const result = await gatherOffers({
    offers: [OFFERS[0]],
    indexPath,
    careerOpsRoot,
    fetchJd,
  });

  assert.equal(isReady(readIndex(indexPath), OFFERS[0].url), false);
  assert.match(result.rows[0].reason, /login/i);
  assert.equal(
    existsSync(path.join(careerOpsRoot, 'jds', jdFileName(OFFERS[0]))),
    false,
  );
});

test('texto curto não vira ready e não deixa arquivo no disco', async () => {
  const { indexPath, careerOpsRoot } = env();
  const fetchJd = async () => ({ text: 'curto', source: 'fake', error: null });

  await gatherOffers({
    offers: [OFFERS[0]],
    indexPath,
    careerOpsRoot,
    fetchJd,
  });

  assert.equal(isReady(readIndex(indexPath), OFFERS[0].url), false);
  assert.equal(
    existsSync(path.join(careerOpsRoot, 'jds', jdFileName(OFFERS[0]))),
    false,
  );
});

test('segunda rodada pula o que já é ready, sem tocar na rede', async () => {
  const { indexPath, careerOpsRoot } = env();
  const fetchJd = async () => ({ text: LONG, source: 'fake', error: null });

  await gatherOffers({
    offers: [OFFERS[0]],
    indexPath,
    careerOpsRoot,
    fetchJd,
  });

  let calls = 0;
  const countingFetch = async () => {
    calls += 1;
    return { text: LONG, source: 'fake', error: null };
  };
  const again = await gatherOffers({
    offers: [OFFERS[0]],
    indexPath,
    careerOpsRoot,
    fetchJd: countingFetch,
  });

  assert.equal(calls, 0);
  assert.equal(again.skipped, 1);
});

test('apagar o índice não força refazer o fetch: o arquivo no disco basta', async () => {
  const { indexPath, careerOpsRoot } = env();
  // o arquivo já existe de uma rodada anterior; o índice, não
  writeFileSync(path.join(careerOpsRoot, 'jds', jdFileName(OFFERS[0])), LONG);

  let calls = 0;
  const countingFetch = async () => {
    calls += 1;
    return { text: LONG, source: 'fake', error: null };
  };
  const result = await gatherOffers({
    offers: [OFFERS[0]],
    indexPath,
    careerOpsRoot,
    fetchJd: countingFetch,
  });

  assert.equal(calls, 0, 'reconstruiu o índice buscando de novo');
  assert.equal(isReady(readIndex(indexPath), OFFERS[0].url), true);
  assert.equal(result.reindexed, 1);
});

test('dry-run não escreve índice nem arquivo, e ainda reporta', async () => {
  const { indexPath, careerOpsRoot } = env();
  const fetchJd = async () => {
    throw new Error('dry-run não deve buscar');
  };

  const result = await gatherOffers({
    offers: OFFERS,
    indexPath,
    careerOpsRoot,
    fetchJd,
    dryRun: true,
  });

  assert.equal(existsSync(indexPath), false);
  assert.equal(
    existsSync(path.join(careerOpsRoot, 'jds', jdFileName(OFFERS[0]))),
    false,
  );
  // 1 LinkedIn certamente missing; 2 seriam tentadas
  assert.equal(result.wouldFetch, 2);
  assert.equal(result.missing, 1);
});

test('--limit corta a lista antes de qualquer fetch', async () => {
  const { indexPath, careerOpsRoot } = env();
  let calls = 0;
  const fetchJd = async () => {
    calls += 1;
    return { text: LONG, source: 'fake', error: null };
  };

  await gatherOffers({
    offers: OFFERS,
    indexPath,
    careerOpsRoot,
    fetchJd,
    limit: 1,
  });

  assert.equal(calls, 1);
  assert.equal(countByStatus(readIndex(indexPath)).ready, 1);
});
