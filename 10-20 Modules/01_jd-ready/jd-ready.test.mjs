import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readIndex,
  isReady,
  jdPathFor,
  countByStatus,
  INDEX_HEADER,
  markReady,
  markMissing,
  JD_MIN_CHARS,
} from './jd-ready.mjs';

function tmp() {
  return mkdtempSync(path.join(tmpdir(), 'jd-ready-'));
}

test('readIndex em arquivo ausente devolve índice vazio, não erro', () => {
  const index = readIndex(path.join(tmp(), 'nao-existe.tsv'));
  assert.equal(index.size, 0);
  assert.equal(isReady(index, 'https://x.com/1'), false);
  assert.equal(jdPathFor(index, 'https://x.com/1'), null);
});

test('readIndex pula o cabeçalho e lê as colunas na ordem do contrato', () => {
  const indexPath = path.join(tmp(), 'jd-ready.tsv');
  writeFileSync(
    indexPath,
    [
      INDEX_HEADER,
      'https://x.com/1\tready\tjds/acme-dev.md\t4821\t2026-10-01',
      'https://linkedin.com/jobs/view/1\tmissing\t\t0\t2026-10-01',
      '',
    ].join('\n'),
  );

  const index = readIndex(indexPath);
  assert.equal(index.size, 2);
  assert.equal(isReady(index, 'https://x.com/1'), true);
  assert.equal(jdPathFor(index, 'https://x.com/1'), 'jds/acme-dev.md');
  assert.equal(index.get('https://x.com/1').chars, 4821);

  assert.equal(isReady(index, 'https://linkedin.com/jobs/view/1'), false);
  assert.equal(jdPathFor(index, 'https://linkedin.com/jobs/view/1'), null);

  assert.deepEqual(countByStatus(index), { ready: 1, missing: 1 });
});

test('linha truncada é ignorada, não derruba a leitura', () => {
  const indexPath = path.join(tmp(), 'jd-ready.tsv');
  writeFileSync(
    indexPath,
    `${INDEX_HEADER}\nhttps://x.com/1\nhttps://x.com/2\tready\tjds/b.md\t900\t2026-10-01\n`,
  );
  const index = readIndex(indexPath);
  // A linha de 1 coluna entra com status vazio — que NÃO é ready. Missing ≠ corrompido.
  assert.equal(isReady(index, 'https://x.com/1'), false);
  assert.equal(isReady(index, 'https://x.com/2'), true);
});

/** Monta um DATA root falso com jds/ e devolve os caminhos. */
function fakeCareerOps() {
  const dir = tmp();
  const career = path.join(dir, 'career-ops');
  mkdirSync(path.join(career, 'jds'), { recursive: true });
  return { indexPath: path.join(dir, 'jd-ready.tsv'), career };
}

test('ready exige arquivo com pelo menos 400 caracteres', () => {
  const { indexPath, career } = fakeCareerOps();
  const url = 'https://jobs.ashbyhq.com/acme/1';

  writeFileSync(path.join(career, 'jds/acme.md'), 'curto');
  const short = markReady({
    indexPath,
    careerOpsRoot: career,
    url,
    jdRel: 'jds/acme.md',
  });
  assert.equal(short.ok, false);
  assert.match(short.reason, /curto/);
  assert.equal(isReady(readIndex(indexPath), url), false);

  writeFileSync(path.join(career, 'jds/acme.md'), 'x'.repeat(JD_MIN_CHARS));
  const long = markReady({
    indexPath,
    careerOpsRoot: career,
    url,
    jdRel: 'jds/acme.md',
  });
  assert.equal(long.ok, true);
  assert.equal(long.chars, JD_MIN_CHARS);
  assert.equal(isReady(readIndex(indexPath), url), true);
});

test('arquivo inexistente nunca vira ready', () => {
  const { indexPath, career } = fakeCareerOps();
  const r = markReady({
    indexPath,
    careerOpsRoot: career,
    url: 'https://x.com/1',
    jdRel: 'jds/fantasma.md',
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /não existe/);
});

test('jd_path que escapa de jds/ é recusado', () => {
  const { indexPath, career } = fakeCareerOps();
  writeFileSync(path.join(career, 'segredo.md'), 'y'.repeat(900));
  for (const jdRel of [
    '../segredo.md',
    'jds/../segredo.md',
    '/etc/passwd',
    '',
  ]) {
    const r = markReady({
      indexPath,
      careerOpsRoot: career,
      url: 'https://x.com/1',
      jdRel,
    });
    assert.equal(r.ok, false, `deveria recusar ${JSON.stringify(jdRel)}`);
  }
  assert.equal(readIndex(indexPath).size, 0);
});

test('jd_path é normalizado para a forma jds/arquivo.md', () => {
  const { indexPath, career } = fakeCareerOps();
  writeFileSync(path.join(career, 'jds/acme.md'), 'x'.repeat(900));
  // passado sem o prefixo jds/
  markReady({
    indexPath,
    careerOpsRoot: career,
    url: 'https://x.com/1',
    jdRel: 'acme.md',
  });
  assert.equal(
    jdPathFor(readIndex(indexPath), 'https://x.com/1'),
    'jds/acme.md',
  );
});

test('URL com tab ou newline é recusada — quebraria o TSV', () => {
  const { indexPath, career } = fakeCareerOps();
  writeFileSync(path.join(career, 'jds/acme.md'), 'x'.repeat(900));
  const r = markReady({
    indexPath,
    careerOpsRoot: career,
    url: 'https://x.com/1\tfake\tready',
    jdRel: 'jds/acme.md',
  });
  assert.equal(r.ok, false);
  assert.equal(readIndex(indexPath).size, 0);
});

test('a mesma URL reescreve a linha, nunca duplica', () => {
  const { indexPath, career } = fakeCareerOps();
  const url = 'https://x.com/1';
  writeFileSync(path.join(career, 'jds/acme.md'), 'x'.repeat(900));

  markMissing({ indexPath, url, reason: 'muro de login' });
  assert.deepEqual(countByStatus(readIndex(indexPath)), {
    ready: 0,
    missing: 1,
  });

  markReady({ indexPath, careerOpsRoot: career, url, jdRel: 'jds/acme.md' });
  assert.deepEqual(countByStatus(readIndex(indexPath)), {
    ready: 1,
    missing: 0,
  });

  markMissing({ indexPath, url });
  assert.deepEqual(countByStatus(readIndex(indexPath)), {
    ready: 0,
    missing: 1,
  });
});

test('o cabeçalho é escrito uma vez, não a cada linha', () => {
  const { indexPath } = fakeCareerOps();
  markMissing({ indexPath, url: 'https://x.com/1' });
  markMissing({ indexPath, url: 'https://x.com/2' });
  const lines = readFileSync(indexPath, 'utf-8').trim().split('\n');
  assert.equal(lines[0], INDEX_HEADER);
  assert.equal(lines.filter((l) => l === INDEX_HEADER).length, 1);
  assert.equal(lines.length, 3);
});
